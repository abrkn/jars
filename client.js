const assert = require('assert');
const Promise = require('bluebird');
const { promisify } = require('util');
const { generate: generateShortId } = require('shortid');
const { safeFunction, safePromise } = require('safep');
const errors = require('./errors');
const debug = require('debug')('jars:client.list');

const DEFAULT_REQUEST_OPTIONS = {
  ackTimeout: 5e3,
  timeout: 30e3,
};

async function createClient(conn, options = {}) {
  assert(conn, 'conn is required');

  const defaultClientRequestOptions = Object.assign({}, DEFAULT_REQUEST_OPTIONS, options.request);

  const pub = conn;

  // Subscribing requires a dedicated connection
  const sub = conn.duplicate();

  const subscribeAsync = promisify(sub.subscribe).bind(sub);
  const lpushAsync = promisify(pub.lpush).bind(pub);
  const lremAsync = promisify(pub.lrem).bind(pub);

  const replyChannel = `jars.reply.${generateShortId()}`;

  const pendingRequests = {};

  async function request(identifier, method, params, options = {}) {
    const optionsWithDefaults = Object.assign({}, defaultClientRequestOptions, options);

    const id = generateShortId();
    const listName = `jars.rpc.${identifier}`;

    const pendingRequest = {};

    const ackPromise = new Promise(ackResolve => {
      Object.assign(pendingRequest, { ...pendingRequest, ackResolve });
    });

    const responsePromise = new Promise((responseResolve, reject) => {
      Object.assign(pendingRequest, { ...pendingRequest, responseResolve, reject });
    });

    const message = {
      id,
      method,
      params,
      meta: {
        replyChannel,
      },
    };

    const encoded = JSON.stringify(message);

    const getRequestDataForError = () => ({
      message,
      identifier,
      optionsWithDefaults,
    });

    try {
      pendingRequests[id] = pendingRequest;

      debug(`REQ --> ${listName}: ${encoded}`);

      await lpushAsync(listName, encoded);

      const [ackError] = await safePromise(ackPromise.timeout(optionsWithDefaults.ackTimeout));

      if (ackError instanceof Promise.TimeoutError) {
        const removed = await lremAsync(listName, 0, encoded);

        if (removed) {
          debug(`Removed REQ ${id} that failed to receive ACK`);
          throw new errors.AckTimeoutError(getRequestDataForError());
        } else if (ackError) {
          throw new errors.RequestError(ackError, getRequestDataForError());
        }

        debug(`Failed to remove REQ ${id}. Assuming it was ACK-ed in race condition`);
      }

      debug(`ACK <-- ${listName}: ${id}`);

      const timeout = optionsWithDefaults.timeout - optionsWithDefaults.ackTimeout;

      const [responseError, response] = await safePromise(responsePromise.timeout(timeout));

      if (responseError instanceof Promise.TimeoutError) {
        throw new errors.ResponseTimeoutError(getRequestDataForError());
      }

      if (responseError) {
        throw new errors.RequestError(responseError, getRequestDataForError());
      }

      return response;
    } finally {
      delete pendingRequests[id];
    }
  }

  async function subscribeToReplies() {
    await subscribeAsync(replyChannel);
  }

  sub.on('message', (channel, encoded) => {
    if (channel !== replyChannel) {
      return;
    }

    debug(`RES <-- ${encoded}`);

    const { id, result, error, status } = JSON.parse(encoded);

    const handler = pendingRequests[id];

    if (!handler) {
      debug(`No handler found for request ${id}`);
      return;
    }

    if (status) {
      const { ackResolve } = handler;
      ackResolve();
      return;
    }

    const { reject, responseResolve } = handler;

    if (result) {
      responseResolve(result);
    } else if (error) {
      reject(Object.assign(new Error(error.message), error));
    } else {
      throw new Error('Unhandled message');
    }
  });

  await subscribeToReplies();

  return {
    request,
    close: () => {
      sub.quit();
      pub.quit();
    },
  };
}

module.exports = createClient;

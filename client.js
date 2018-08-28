const assert = require('assert');
const debug = require('debug')('jars:client');
const { promisify } = require('util');
const { EventEmitter } = require('events');
const redis = require('redis');
const { generate: generateShortId } = require('shortid');
const Promise = require('bluebird');

const ACK_TIMEOUT = 5e3;
const RESPONSE_TIMEOUT = 30e3;

async function createRpcClient(conn) {
  const sub = conn.duplicate();
  const pub = conn.duplicate();
  const requests = {};
  const replyTo = generateShortId();
  let requestCounter = 0;

  const pubPublishAsync = promisify(pub.publish).bind(pub);

  sub.on('message', (channel, encoded) => {
    debug(`RES <-- ${encoded}`);

    const { id, result, error, status } = JSON.parse(encoded);

    const handler = requests[id];

    if (!handler) {
      debug(`No handler found for request ${id}`);
      return;
    }

    if (status) {
      const { ackResolve } = handler;
      ackResolve();
      return;
    }

    const { responseReject, responseResolve } = handler;

    if (result) {
      responseResolve(result);
    } else {
      responseReject(Object.assign(new Error(error.message), error));
    }
  });

  await promisify(sub.subscribe).bind(sub)(replyTo);

  const request = async (
    channel,
    method,
    params = {},
    { ackTimeout = ACK_TIMEOUT, responseTimeout = RESPONSE_TIMEOUT } = {}
  ) => {
    const id = (++requestCounter).toString();
    const request = {};

    const ackPromise = new Promise(ackResolve => {
      Object.assign(request, { ...request, ackResolve });
    });

    const responsePromise = new Promise((responseResolve, responseReject) => {
      Object.assign(request, { ...request, responseResolve, responseReject });
    });

    requests[id] = request;

    const encoded = JSON.stringify({
      id,
      method,
      meta: { replyTo },
      params,
    });

    try {
      await pubPublishAsync(channel, encoded);
      debug(`REQ --> ${channel}: ${encoded}`);

      await ackPromise.timeout(ackTimeout);
      debug(`ACK <-- ${channel}: ${id}`);

      return await responsePromise.timeout(responseTimeout);
    } finally {
      delete requests[id];
    }
  };

  return {
    request,
    close: () => {
      sub.quit();
      pub.quit();
    },
  };
}

module.exports = createRpcClient;

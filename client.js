const assert = require('assert');
const debug = require('debug')('jars:client');
const { promisify } = require('util');
const { EventEmitter } = require('events');
const redis = require('redis');
const { promisifyAll } = require('bluebird');
const { generate: generateShortId } = require('shortid');
const Promise = require('bluebird');

assert(!redis.getAsync);
promisifyAll(redis);

const ACK_TIMEOUT = 5e3;
const RESPONSE_TIMEOUT = 30e3;

async function createRpcClient(conn) {
  const sub = conn.duplicate();
  const pub = conn.duplicate();
  const requests = {};
  const replyTo = generateShortId();
  let requestCounter = 0;

  sub.on('message', (channel, encoded) => {
    debug(`RES <-- ${encoded}`);

    const { id, result, error, status } = JSON.parse(encoded);

    const handler = requests[id];

    if (!handler) {
      debug(`No handler found for request ${id}`);
      return;
    }

    const { reject, resolve } = handler;

    delete requests[id];

    if (status) {
      resolve('ack');
    } else if (result) {
      resolve(result);
    } else {
      reject(Object.assign(new Error(error.message), error));
    }
  });

  await sub.subscribeAsync(replyTo);

  const request = async (
    channel,
    method,
    params = {},
    { ackTimeout = ACK_TIMEOUT, responseTimeout = RESPONSE_TIMEOUT } = {}
  ) => {
    const id = (++requestCounter).toString();

    const ackPromise = new Promise((resolve, reject) => {
      requests[id] = { resolve, reject };
    });

    const encoded = JSON.stringify({
      id,
      method,
      meta: { replyTo },
      params,
    });

    try {
      await pub.publishAsync(channel, encoded);
      debug(`REQ --> ${channel}: ${encoded}`);

      await ackPromise.timeout(ackTimeout);
      debug(`ACK <-- ${channel}: ${id}`);

      const responsePromise = new Promise((resolve, reject) => {
        requests[id] = { resolve, reject };
      });

      return await responsePromise.timeout(responseTimeout);
    } catch (error) {
      delete requests[id];
      throw error;
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

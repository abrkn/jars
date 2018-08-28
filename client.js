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

async function createRpcClient(conn) {
  const sub = conn.duplicate();
  const pub = conn.duplicate();
  const requests = {};
  const replyTo = generateShortId();
  let requestCounter = 0;

  sub.on('message', (channel, encoded) => {
    debug(`RES <-- ${encoded}`);

    const { id, result, error } = JSON.parse(encoded);

    const handler = requests[id];

    if (!handler) {
      debug(`No handler found for request ${id}`);
      return;
    }

    const { reject, resolve } = handler;

    delete requests[id];

    if (result) {
      resolve(result);
    } else {
      reject(Object.assign(new Error(error.message), error));
    }
  });

  await sub.subscribeAsync(replyTo);

  const request = async (channel, method, params = {}) => {
    const id = (++requestCounter).toString();

    const promise = new Promise((resolve, reject) => {
      requests[id] = { resolve, reject };
    });

    const encoded = JSON.stringify({
      id,
      method,
      meta: { replyTo },
      params,
    });
    debug(`REQ --> ${channel}: ${encoded}`);

    try {
      await pub.publishAsync(channel, encoded);
      return await promise.timeout(10e3);
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

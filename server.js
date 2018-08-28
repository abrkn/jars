const assert = require('assert');
const debug = require('debug')('jars:server');
const { promisify } = require('util');
const { EventEmitter } = require('events');
const redis = require('redis');
const { promisifyAll } = require('bluebird');
const { generate: generateShortId } = require('shortid');

assert(!redis.getAsync);
promisifyAll(redis);

async function createRpcServer(conn, channel, handler) {
  const sub = conn.duplicate();
  const pub = conn.duplicate();

  sub.on('message', (channel, encoded) => {
    debug(`REQ <-- ${encoded}`);

    const { method, params, id } = JSON.parse(encoded);
    const { replyTo } = params;

    const reply = async message => {
      const encoded = JSON.stringify({ id, ...message });
      debug(`RES --> ${replyTo}: ${encoded}`);
      await pub.publishAsync(replyTo, encoded);
    };

    const replyWithError = async (error, code, data) => {
      let errorAsString;

      if (error instanceof Error) {
        errorAsString =
          process.env.NODE_ENV === 'production'
            ? 'Internal Server Error'
            : error.message;
      } else {
        errorAsString = error.toString();
      }

      return await reply({
        error: {
          code: code || -32000,
          message: errorAsString,
          ...(data ? { data } : {}),
        },
      });
    };

    const replyWithResult = async result => reply({ result });

    handler({ method, params, reply, replyWithResult, replyWithError });
  });

  await sub.subscribeAsync(channel);

  return {
    close: () => {
      sub.quit();
      pub.quit();
    },
  };
}

module.exports = createRpcServer;

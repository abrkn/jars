const assert = require('assert');
const debug = require('debug')('jars:server');
const redis = require('redis');
const { promisify } = require('util');

async function createRpcServer(conn, channel, handler) {
  const sub = conn.duplicate();
  const pub = conn.duplicate();

  const subSubscribeAsync = promisify(sub.subscribe).bind(sub);
  const pubPublishAsync = promisify(pub.publish).bind(pub);

  sub.on('message', (channel, encoded) => {
    debug(`REQ <-- ${encoded}`);

    const { method, params, id, meta } = JSON.parse(encoded);

    const { replyTo } = meta;
    assert(replyTo, 'replyTo is required');

    const reply = async message => {
      const encoded = JSON.stringify({ id, ...message });
      debug(`RES --> ${replyTo}: ${encoded}`);
      await pubPublishAsync(replyTo, encoded);
    };

    const ack = async () => {
      const encoded = JSON.stringify({ id, status: 'ack' });
      debug(`ACK --> ${replyTo}: ${id}`);
      await pubPublishAsync(replyTo, encoded);
    };

    const replyWithError = async (error, code, data) => {
      let errorAsString;

      if (error instanceof Error) {
        errorAsString = 'Internal Server Error';
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

    Promise.resolve()
      .then(ack)
      .then(() =>
        handler({ method, params, reply, replyWithResult, replyWithError })
      )
      .catch(replyWithError);
  });

  await subSubscribeAsync(channel);

  return {
    close: () => {
      sub.quit();
      pub.quit();
    },
  };
}

module.exports = createRpcServer;

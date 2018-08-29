const assert = require('assert');
const debug = require('debug')('jars:server');
const redis = require('redis');
const { promisify } = require('util');
const { EventEmitter } = require('events');

async function createRpcServer(conn, channel, handler) {
  const sub = conn.duplicate();
  const pub = conn.duplicate();

  const subSubscribeAsync = promisify(sub.subscribe).bind(sub);
  const pubPublishAsync = promisify(pub.publish).bind(pub);
  const pubKeysAsync = promisify(pub.keys).bind(pub);

  const handleRequest = function handleRequest(encoded) {
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
        debug(`Unhandled error: ${error.stack}`);
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
  };

  // NOTE: Race condition with multiple readers
  const drainQueuedRequests = async () => {
    const keys = await pubKeysAsync(`${channel}.queue.*`);

    if (!keys.length) {
      return;
    }

    debug(`Found ${keys.length} queued request(s)`);

    // https://github.com/NodeRedis/node_redis#clientmulticommands
    const pubGetAndDel = (key, callback) =>
      pub
        .multi()
        .get(key)
        .del(key)
        .exec(
          (error, result) =>
            error ? callback(error) : callback(null, result[0])
        );

    // const pubGetAndDelAsync = promisify(pubGetAndDel);
    const pubGetAndDelAsync = key =>
      new Promise((resolve, reject) =>
        pubGetAndDel(
          key,
          (error, result) => (error ? reject(error) : resolve(result))
        )
      );

    const requests = await Promise.all(keys.map(pubGetAndDelAsync));
    requests.forEach(handleRequest);
  };

  sub.on('message', (channel, encoded) => handleRequest(encoded));

  const start = async () => {
    await drainQueuedRequests();
    await subSubscribeAsync(channel);
  };

  const emitter = new EventEmitter();

  setImmediate(() => start().catch(error => emitter.emit(error)));

  return Object.assign(emitter, {
    close: () => {
      sub.quit();
      pub.quit();
    },
  });
}

module.exports = createRpcServer;

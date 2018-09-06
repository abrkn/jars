const assert = require('assert');
const debug = require('debug')('jars:server');
const redis = require('redis');
const { promisify } = require('util');
const { EventEmitter } = require('events');

async function createRpcServer(conn, identifier, handler) {
  const pub = conn.duplicate();
  const sub = conn.duplicate();

  const publishAsync = promisify(pub.publish).bind(pub);

  const listName = `jars.rpc.${identifier}`;

  const handleRequest = function handleRequest(encoded) {
    debug(`REQ <-- ${encoded}`);

    const { method, params, id, meta } = JSON.parse(encoded);

    const { replyChannel } = meta;
    assert(replyChannel, 'replyChannel is required');

    const reply = async message => {
      const encoded = JSON.stringify({ id, ...message });
      debug(`RES --> ${replyChannel}: ${encoded}`);
      await publishAsync(replyChannel, encoded);
    };

    const ack = async () => {
      const encoded = JSON.stringify({ id, status: 'ack' });
      debug(`ACK --> ${replyChannel}: ${id}`);
      await publishAsync(replyChannel, encoded);
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
          code: code || 'InternalServerError',
          message: errorAsString,
          ...(data ? { data } : {}),
        },
      });
    };

    const replyWithResult = async result => reply({ result });

    Promise.resolve()
      .then(ack)
      .then(() => handler({ method, params, reply, replyWithResult, replyWithError, error: replyWithError }))
      .catch(replyWithError);
  };

  const emitter = new EventEmitter();

  const popNextRequest = () =>
    sub.blpop(listName, 0, (error, result) => {
      if (error) {
        emitter.emit('error', error);
        return;
      }

      const [, encoded] = result;

      setImmediate(() => handleRequest(encoded));

      popNextRequest();
    });

  setImmediate(popNextRequest);

  debug(`Listening for RPC requests on list ${listName}`);

  return Object.assign(emitter, {
    close: () => {
      debug(`Closing redis connections`);
      sub.quit();
      pub.quit();
    },
  });
}

module.exports = createRpcServer;

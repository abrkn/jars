const assert = require('assert');
const debug = require('debug')('jars:server');
const { promisify } = require('util');
const { EventEmitter } = require('events');

async function createRpcServer(conn, identifier, handler) {
  assert(conn, 'conn is required');
  assert.equal(typeof identifier, 'string', 'identifier must be a string');
  assert.equal(typeof handler, 'function', 'handler must be a function');

  const pub = conn;
  const sub = conn.duplicate();

  let closePromise;
  let isClosing = false;

  const pendingRequests = [];

  const publishAsync = promisify(pub.publish).bind(pub);

  const listName = `jars.rpc.${identifier}`;

  const handleRequest = function handleRequest(encoded) {
    debug(`REQ <-- ${encoded}`);

    if (closePromise) {
      debug(`Received request while closing. Ignoring`);
      return;
    }

    // TODO: Parsing must be moved into a try...catch
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

    const requestPromise = (async () => {
      try {
        await ack();
        await handler({ method, params, reply, replyWithResult, replyWithError, error: replyWithError });
      } catch (error) {
        await replyWithError(error);
      } finally {
        pendingRequests.splice(pendingRequests.indexOf(requestPromise), 1);
        debug(`Pending request count reduced to ${pendingRequests.length}`);
      }
    })();

    pendingRequests.push(requestPromise);
    debug(`Pending request count increased to ${pendingRequests.length}`);
  };

  const emitter = new EventEmitter();

  const popNextRequest = () =>
    sub.blpop(listName, 0, (error, result) => {
      if (isClosing) {
        debug('Will not pop another. Server is closing.');
        return;
      }

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
    close: async () => {
      if (!isClosing) {
        isClosing = true;

        closePromise = (async () => {
          debug(`Closing`);

          // Stop accepting new requests
          debug('Quitting subscription connection');
          sub.end(false);
          debug('Quit subscription connection');

          // Wait for all pending requests
          if (pendingRequests.length) {
            debug(`Waiting for ${pendingRequests.length} requests to finish`);
            await Promise.all(pendingRequests.map(request => request.catch(_ => true)));
          }

          // Quit publishing Redis connection
          debug('Quitting publishing connection');
          pub.end(false);
          debug('Quit publishing connection');
        })();
      }

      assert(closePromise, 'Race condition');

      return closePromise;
    },
  });
}

module.exports = createRpcServer;

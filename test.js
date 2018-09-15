const Promise = require('bluebird');
const test = require('ava');
const errors = require('./errors');
const createRpcClient = require('./client');
const createRpcServer = require('./server');
const createApplication = require('./application');
const redis = require('redis');
const { withQuietAckTimeout } = require('./helpers');
const { generate: generateShortId } = require('shortid');

test('calculator client/server', async t => {
  const conn = redis.createClient();
  const channel = generateShortId();

  const handler = ({ method, params, replyWithResult, replyWithError }) => {
    if (method === 'add') {
      return replyWithResult(params.n.reduce((p, c) => p + c, 0));
    }

    if (method === 'multiply') {
      return replyWithResult(params.n.reduce((p, c) => p * c, 1));
    }

    return replyWithError(`Unknown method ${method}`);
  };

  const server = await createRpcServer(conn.duplicate(), channel, handler);
  const client = await createRpcClient(conn.duplicate());

  const addResult = await client.request(channel, 'add', {
    n: [1, 2, 3],
  });
  t.is(addResult, 6);

  const multiplyResult = await client.request(channel, 'multiply', {
    n: [1, 2, 3],
  });

  t.is(multiplyResult, 6);

  try {
    await client.request(channel, 'divide', [123]);
    t.fail('Expected divide invocation to fail');
  } catch (error) {
    t.regex(error.message, /unknown method/i);
  }

  client.close();
  return server.close();
});

test('calculator client/application', async t => {
  const conn = redis.createClient();
  const channel = generateShortId();

  const app = await createApplication(conn.duplicate(), channel);

  app.add('multiply', (req, res) => res.send(req.params.n.reduce((p, c) => p + c, 0)));

  const client = await createRpcClient(conn.duplicate());

  const multiplyResult = await client.request(channel, 'multiply', {
    n: [1, 2, 3],
  });

  t.is(multiplyResult, 6);

  try {
    await client.request(channel, 'divide', [123]);
    t.fail('Expected divide invocation to fail');
  } catch (error) {
    t.regex(error.message, /unhandled/i);
  }

  client.close();
  await app.close();
});

test('ack timeout', async t => {
  const conn = redis.createClient();
  const channel = generateShortId();

  const client = await createRpcClient(conn.duplicate());

  const startAt = new Date().getTime();

  try {
    await client.request(channel, 'test', {}, { ackTimeout: 1 });
  } catch (error) {
    if (error instanceof errors.AckTimeoutError) {
      t.true(new Date().getTime() - startAt < 100);
      return;
    }

    throw error;
  }

  client.close();
});

test('uncaught error in handler', async t => {
  const conn = redis.createClient();
  const channel = generateShortId();

  const app = await createApplication(conn.duplicate(), channel);

  app.add('throw', (req, res) => {
    throw new Error('Intentionally thrown');
  });

  const client = await createRpcClient(conn.duplicate());

  try {
    await client.request(channel, 'throw');
    t.fail('Expected error');
  } catch (error) {
    t.regex(error.message, /internal server/i);
  }

  client.close();
  app.close();
});

test('queued request', async t => {
  const conn = redis.createClient();
  const channel = generateShortId();

  const client = await createRpcClient(conn.duplicate());
  const resultPromise = client.request(channel, 'foo');

  // Sleep for 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2e3));

  const app = await createApplication(conn.duplicate(), channel);

  app.add('foo', (req, res) => res.send('bar'));

  const result = await resultPromise;

  t.is(result, 'bar');

  await app.close();
  client.close();
});

test('withQuietAckTimeout (times out)', async t => {
  const conn = redis.createClient();
  const channel = generateShortId();

  const client = await createRpcClient(conn.duplicate());

  const result = await withQuietAckTimeout(client.request(channel, 'test', {}, { ackTimeout: 1 }));
  t.is(result, undefined);

  await client.close();
});

test('withQuietAckTimeout (returns)', async t => {
  const conn = redis.createClient();
  const channel = generateShortId();

  const client = await createRpcClient(conn.duplicate());

  const app = await createApplication(conn.duplicate(), channel);
  app.add('foo', (req, res) => res.send('bar'));

  const result = await withQuietAckTimeout(client.request(channel, 'foo'));
  t.is(result, 'bar');

  client.close();
  await app.close();
});

test('request draining', async t => {
  const BASE_TIME = 500;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const channel = generateShortId();

  const conn = redis.createClient();

  const app = await createApplication(conn.duplicate(), channel);

  app.add('slow', async (req, res) => {
    await delay(BASE_TIME * 4);
    await res.send(true);
  });

  const client = await createRpcClient(conn.duplicate());

  const resultPromise = client.request(channel, 'slow');
  let resultResolved = false;

  resultPromise.then(_ => {
    resultResolved = true;
  });

  await delay(BASE_TIME);

  const closePromise = app.close(true);

  await delay(BASE_TIME);

  // Should not be resolved just yet
  t.is(resultResolved, false);

  await closePromise;

  await delay(BASE_TIME);

  const result = await resultPromise;

  t.is(result, true);

  client.close();
});

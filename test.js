const Promise = require('bluebird');
const test = require('ava');
// const createRpcClient = require('./client');
// const createRpcServer = require('./server');
const createRpcClient = require('./client.list');
const createRpcServer = require('./server.list');
const createApplication = require('./application');
const redis = require('redis');

test('calculator client/server', async t => {
  const conn = redis.createClient();

  const handler = ({ method, params, replyWithResult, replyWithError }) => {
    if (method === 'add') {
      return replyWithResult(params.n.reduce((p, c) => p + c, 0));
    }

    if (method === 'multiply') {
      return replyWithResult(params.n.reduce((p, c) => p * c, 1));
    }

    return replyWithError(`Unknown method ${method}`);
  };

  const server = await createRpcServer(
    conn.duplicate(),
    'calculator c/s',
    handler
  );
  const client = await createRpcClient(conn.duplicate());

  const addResult = await client.request('calculator c/s', 'add', {
    n: [1, 2, 3],
  });
  t.is(addResult, 6);

  const multiplyResult = await client.request('calculator c/s', 'multiply', {
    n: [1, 2, 3],
  });

  t.is(multiplyResult, 6);

  try {
    await client.request('calculator c/s', 'divide', [123]);
    t.fail('Expected divide invocation to fail');
  } catch (error) {
    t.regex(error.message, /unknown method/i);
  }

  server.close();
  client.close();
});

test('calculator client/application', async t => {
  const conn = redis.createClient();

  const app = await createApplication(conn.duplicate(), 'calculator c/a');

  app.add('add', (req, res) =>
    res.send(req.params.n.reduce((p, c) => p + c, 0))
  );
  app.add('multiply', (req, res) =>
    res.send(req.params.n.reduce((p, c) => p + c, 0))
  );

  const client = await createRpcClient(conn.duplicate());

  const addResult = await client.request('calculator c/a', 'add', {
    n: [1, 2, 3],
  });
  t.is(addResult, 6);

  const multiplyResult = await client.request('calculator c/a', 'multiply', {
    n: [1, 2, 3],
  });

  t.is(multiplyResult, 6);

  try {
    await client.request('calculator c/a', 'divide', [123]);
    t.fail('Expected divide invocation to fail');
  } catch (error) {
    t.regex(error.message, /unhandled/i);
  }

  client.close();
  app.close();
});

test('ack timeout', async t => {
  const conn = redis.createClient();
  const channel = 'ack timeout';

  const client = await createRpcClient(conn.duplicate());

  const startAt = new Date().getTime();

  try {
    await client.request(channel, 'test', {}, { ackTimeout: 1 });
  } catch (error) {
    if (error instanceof Promise.TimeoutError) {
      t.true(new Date().getTime() - startAt < 100);
      return;
    }

    throw error;
  }

  client.close();
});

test('uncaught error in handler', async t => {
  const conn = redis.createClient();
  const channel = 'uncaught';

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
  const channel = 'queued request';

  const client = await createRpcClient(conn.duplicate());
  const resultPromise = client.request(channel, 'foo');

  // Sleep for 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2e3));

  const app = await createApplication(conn.duplicate(), channel);

  app.add('foo', (req, res) => res.send('bar'));

  const result = await resultPromise;

  t.is(result, 'bar');

  client.close();
  app.close();
});

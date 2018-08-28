const Promise = require('bluebird');
const test = require('ava');
const createRpcClient = require('./client');
const createRpcServer = require('./server');
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

  const client = await createRpcClient(conn.duplicate());

  const startAt = new Date().getTime();

  try {
    await client.request('ack timeout', 'test', {}, { ackTimeout: 1 });
  } catch (error) {
    if (error instanceof Promise.TimeoutError) {
      t.true(new Date().getTime() - startAt < 100);
      return;
    }

    throw error;
  }

  client.close();
});

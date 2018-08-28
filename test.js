const test = require('ava');
const createRpcClient = require('./client');
const createRpcServer = require('./server');
const redis = require('redis');

test('calculator', async t => {
  const conn = redis.createClient();

  const handler = ({ method, params, replyWithResult, replyWithError }) => {
    if (method === 'add') {
      return replyWithResult(params.n.reduce((p, c) => p + c, 0));
    }

    if (method === 'multiply') {
      return replyWithResult(params.n.reduce((p, c) => p + c, 0));
    }

    return replyWithError(`Unknown method ${method}`);
  };

  const server = await createRpcServer(conn.duplicate(), 'calculator', handler);
  const client = await createRpcClient(conn.duplicate());

  const addResult = await client.request('calculator', 'add', { n: [1, 2, 3] });
  t.is(addResult, 6);

  const multiplyResult = await client.request('calculator', 'multiply', {
    n: [1, 2, 3],
  });

  t.is(multiplyResult, 6);

  try {
    await client.request('calculator', 'divide', [123]);
    t.fail('Expected divide invocation to fail');
  } catch (error) {
    t.regex(error.message, /unknown method/i);
  }
});

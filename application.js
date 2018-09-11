const assert = require('assert');
const createRouter = require('./router');
const createRpcServer = require('./server');
const runMiddleware = require('./middleware');
const { pick } = require('lodash');
const debug = require('debug')('jars:application');

async function createApplication(conn, identifier) {
  assert(conn, 'conn is required');
  assert.equal(typeof identifier, 'string', 'identifier must be a string');

  const app = {};

  const router = createRouter();

  const middleware = [router];
  const errorHandlers = [];

  const use = method => {
    // const isErrorHandler = !!method.toString().match(/\(err/);
    const isErrorHandler = method.length === 4; // err, req, res, next

    if (isErrorHandler) {
      errorHandlers.push(method);
    } else {
      middleware.push(method);
    }
  };

  const add = router.add;

  const handler = ({ method, params, reply, replyWithResult, replyWithError }) => {
    const req = {
      app,
      method,
      params,
      stop: false,
    };

    const res = {
      send: result => {
        res.stop = true;
        replyWithResult(result);
      },
      error: (...args) => {
        res.stop = true;
        replyWithError(...args);
      },
    };

    const unhandled = (req, res) => {
      debug(`Unhandled: ${req.method}`);
      res.error('Unhandled request');
    };

    const unhandledError = (err, req, res) => {
      const isProduction = process.env.NODE_ENV === 'production';
      res.error(
        'Internal server error',
        'InternalServerError',
        isProduction ? null : pick(err, 'message', 'stack', 'code', 'name')
      );
    };

    runMiddleware([...middleware, unhandled], [...errorHandlers, unhandledError], req, res);
  };

  const server = await createRpcServer(conn, identifier, handler);

  const close = server.close;

  Object.assign(app, { server, router, middleware, use, add, close });

  return app;
}

module.exports = createApplication;

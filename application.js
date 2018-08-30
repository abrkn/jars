const createRouter = require('./router');
const createRpcServer = require('./server');
const runMiddleware = require('./middleware');
const debug = require('debug')('jars:application');

async function createApplication(conn, channel) {
  const app = {};

  const router = createRouter();

  const middleware = [router];

  const use = method => middleware.push(method);

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
      error: error => {
        res.stop = true;
        replyWithError(error);
      },
    };

    const unhandled = (req, res) => {
      debug(`Unhandled: ${req.method}`);
      res.error('Unhandled request');
    };

    runMiddleware([...middleware, unhandled], req, res);
  };

  const server = await createRpcServer(conn, channel, handler);

  const close = server.close;

  Object.assign(app, { server, router, middleware, use, add, close });

  return app;
}

module.exports = createApplication;

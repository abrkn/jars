const assert = require('assert');
const debug = require('debug')('jars:router');

function createRouter() {
  const routes = {};

  const add = function add(method, handler) {
    assert(method && method.length);
    assert(!routes[method], 'Duplicate route');
    routes[method] = handler;
    debug(`Added route ${method}`);
  };

  const route = function route(req, res, next) {
    debug(`Routing method ${req.method || '<none>'}`);
    const route = routes[req.method];

    if (!route) {
      debug(`No route found for ${req.method}`);
      return next();
    }

    debug('Found route');

    return route(req, res, next);
  };

  return Object.assign(route, {
    add,
  });
}

module.exports = createRouter;

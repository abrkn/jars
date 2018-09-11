const debug = require('debug')('jars:middleware');

function runErrorMiddleware(fns, err, req, res) {
  debug(`Running error middleware for ${err.message}`);

  const remaining = fns.slice();

  const pop = () => {
    const next = error => {
      if (error) {
        if (error !== err) {
          debug(`Error changed to ${err.message}`);
          err = error;
        }
      }

      if (res.stop) {
        return;
      }

      pop();
    };

    const fn = remaining.shift();
    const result = fn(err, req, res, next);

    if (result && result.then) {
      result.then(_ => next()).catch(next);
    }
  };

  pop();
}

module.exports = function runMiddleware(fns, errFns, req, res) {
  const remaining = fns.slice();

  const pop = () => {
    const next = error => {
      if (error) {
        runErrorMiddleware(errFns, error, req, res);
        return;
      }

      if (res.stop) {
        return;
      }

      pop();
    };

    const fn = remaining.shift();
    const result = fn(req, res, next);

    if (result && result.then) {
      result.then(_ => next()).catch(next);
    }
  };

  pop();
};

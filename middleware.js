const assert = require('assert');
const debug = require('debug')('jars:middleware');

async function runErrorMiddleware(fns, err, req, res) {
  assert(err instanceof Error);

  debug('Running error middleware for %s', err.message);

  const remaining = fns.slice();

  const pop = async () => {
    const next = error => {
      let ranNext;

      if (error) {
        assert(!ranNext);
        ranNext = true;

        if (error !== err) {
          debug(`Error changed to ${err.message}`);
          err = error;
        }
      }

      if (res.stop) {
        return;
      }

      return pop();
    };

    const fn = remaining.shift();

    try {
      await fn(err, req, res, next);
    } catch (error) {
      return next(error);
    }
  };

  return pop();
}

module.exports = async function runMiddleware(fns, errFns, req, res) {
  const remaining = fns.slice();

  const pop = async () => {
    let ranNext;

    const next = async error => {
      assert(!ranNext);
      ranNext = true;

      if (error) {
        return runErrorMiddleware(errFns, error, req, res);
      }

      if (res.stop) {
        return;
      }

      return pop();
    };

    const fn = remaining.shift();

    try {
      await fn(req, res, next);
    } catch (error) {
      next(error);
    }
  };

  return pop();
};

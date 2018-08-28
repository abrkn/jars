module.exports = function runMiddleware(fns, req, res) {
  const remaining = fns.slice();

  const pop = () => {
    const next = error => {
      if (error) {
        res.error(error);
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

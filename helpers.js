const errors = require('./errors');

exports.withQuietAckTimeout = promise =>
  promise.then(null, error => (error instanceof errors.AckTimeoutError ? undefined : Promise.reject(error)));

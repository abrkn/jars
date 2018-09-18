const errors = require('./errors');

exports.withQuietAckTimeout = promise =>
  promise.then(null, error => (error instanceof errors.AckTimeoutError ? undefined : Promise.reject(error)));

exports.MAX_RAW_DEBUG_LENGTH = 200;

exports.createDebugRaw = (prefix, maxLength = exports.MAX_RAW_DEBUG_LENGTH) => {
  const log = require('debug')(`${prefix}:raw`);
  return text => log(text.toString().substr(0, maxLength));
};

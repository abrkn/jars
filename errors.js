exports.RequestError = class RequestError extends Error {
  constructor(messageOrInnerError, request, { response } = {}) {
    const innerError = messageOrInnerError instanceof Error && messageOrInnerError;
    const message = innerError ? messageOrInnerError.message : messageOrInnerError;

    super(message);

    Object.assign(this, {
      request,
      response,
      ...(innerError && innerError),
    });

    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
};

exports.AckTimeoutError = class AckTimeoutError extends exports.RequestError {
  constructor(request) {
    const message = `Timed out waiting for consumer to acknowledge receipt of the request`;
    super(message, request);

    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
};

exports.ResponseTimeoutError = class ResponseTimeoutError extends exports.RequestError {
  constructor(request) {
    const message = `Timed out waiting for response`;
    super(message, request);

    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
};

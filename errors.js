exports.RequestError = class RequestError extends Error {
  constructor(messageOrInnerError, request, { response } = {}) {
    const innerError = messageOrInnerError instanceof Error && messageOrInnerError;
    const message = innerError ? messageOrInnerError.message : messageOrInnerError;

    super(message);

    Object.assign(this, {
      request,
      response,
      ...(innerError && { innerError }),
    });

    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
};

exports.AckTimeoutError = class AckTimeoutError extends exports.RequestError {
  constructor(request) {
    const message = `Timed out waiting for the consumer to acknowledged receipt of the request`;
    super(message, request);

    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
};

'use strict';

const { AppError } = require('../utils/errors');
const { sendError } = require('../utils/response');
const logger = require('../utils/logger');
const env = require('../config/env');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body is not valid JSON.');
  }
  if (err.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  }

  logger.error({ err, url: req.originalUrl, method: req.method }, 'Unhandled request error');
  const message = env.isProduction ? 'Something went wrong.' : err.message || 'Something went wrong.';
  return sendError(res, 500, 'INTERNAL_ERROR', message);
}

module.exports = { errorHandler };

'use strict';

function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

function buildErrorBody(code, message, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { success: false, error };
}

function sendError(res, statusCode, code, message, details) {
  return res.status(statusCode).json(buildErrorBody(code, message, details));
}

module.exports = { sendSuccess, sendError, buildErrorBody };

'use strict';

const { sendError } = require('../utils/response');

function notFound(req, res) {
  if (req.path.startsWith('/api/') || !req.accepts('html')) {
    return sendError(res, 404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found.`);
  }
  return res.status(404).render('not-found', { title: 'Not found' });
}

module.exports = { notFound };

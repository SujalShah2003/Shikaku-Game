'use strict';

const pinoHttp = require('pino-http');
const logger = require('../utils/logger');

const QUIET_PREFIXES = ['/css/', '/js/', '/assets/', '/favicon', '/socket.io/'];

const httpLogger = pinoHttp({
  logger,
  autoLogging: { ignore: (req) => QUIET_PREFIXES.some((prefix) => req.url.startsWith(prefix)) },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

module.exports = { httpLogger };

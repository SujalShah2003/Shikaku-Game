'use strict';

const pino = require('pino');
const env = require('../config/env');

function buildTransport() {
  if (env.isProduction || env.isTest) return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } };
  } catch {
    return undefined;
  }
}

const logger = pino({
  level: env.logLevel,
  base: { service: 'shikaku-game' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'mongodbUri', '*.password'],
    remove: true,
  },
  transport: buildTransport(),
});

module.exports = logger;

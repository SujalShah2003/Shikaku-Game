'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const { GAME_CONFIG, DIFFICULTIES } = require('./config/game.config');
const { getDatabaseStatus } = require('./config/database');
const { createGameRouter } = require('./routes/game.routes');
const { httpLogger } = require('./middleware/logger.middleware');
const { notFound } = require('./middleware/not-found.middleware');
const { errorHandler } = require('./middleware/error.middleware');

const ROOT = path.join(__dirname, '..');

/** CORS allow-list from CLIENT_URL. Same-origin requests (the bundled frontend) never need it. */
function buildCorsOptions() {
  return {
    origin(origin, callback) {
      callback(null, !origin || env.clientUrls.includes(origin));
    },
    methods: ['GET', 'POST'],
  };
}

/** Client-safe subset of the game configuration, embedded in the page as JSON. */
function publicClientConfig() {
  return {
    limits: {
      minRows: GAME_CONFIG.minRows,
      maxRows: GAME_CONFIG.maxRows,
      minColumns: GAME_CONFIG.minColumns,
      maxColumns: GAME_CONFIG.maxColumns,
      maxRectangleWidth: GAME_CONFIG.maxRectangleWidth,
      maxRectangleHeight: GAME_CONFIG.maxRectangleHeight,
    },
    difficulties: DIFFICULTIES.map((key) => ({
      key,
      rows: GAME_CONFIG.difficulties[key].rows,
      columns: GAME_CONFIG.difficulties[key].columns,
    })),
    defaultDifficulty: GAME_CONFIG.defaultDifficulty,
  };
}

function createApp({ gameService, healthCheck = getDatabaseStatus }) {
  const app = express();

  if (env.isProduction) app.set('trust proxy', 1); // Render terminates TLS at its proxy.
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'views'));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'", ...env.clientUrls],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  app.use(cors(buildCorsOptions()));
  app.use(httpLogger);
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: env.isProduction ? '1h' : 0 }));

  app.get('/health', (_req, res) => {
    const database = healthCheck();
    const healthy = database === 'connected';
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', database, uptime: Math.round(process.uptime()) });
  });

  app.get('/', (_req, res) => {
    const config = publicClientConfig();
    const clientConfig = JSON.stringify(config).replace(/</g, '\\u003c');
    res.render('game', { title: 'Shikaku — Grid Puzzle', clientConfig, difficulties: config.difficulties });
  });

  app.use('/api/games', createGameRouter(gameService));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

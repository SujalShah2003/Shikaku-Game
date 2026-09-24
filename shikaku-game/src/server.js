'use strict';

const http = require('node:http');
const { Server } = require('socket.io');
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const gameRepository = require('./repositories/game.repository');
const { createGameService } = require('./services/game');
const { createApp } = require('./app');
const { registerGameSocket } = require('./socket/game.socket');

const SHUTDOWN_TIMEOUT_MS = 10000;

function createSocketServer(httpServer) {
  const options = {};
  // Same-origin clients always work; CLIENT_URL adds extra allowed origins.
  if (env.clientUrls.length > 0) options.cors = { origin: env.clientUrls, methods: ['GET', 'POST'] };
  return new Server(httpServer, options);
}

async function start() {
  await connectDatabase();

  const gameService = createGameService({ repository: gameRepository });
  const app = createApp({ gameService });
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);
  registerGameSocket(io, gameService);

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(env.port, resolve);
  }).catch(async (err) => {
    await disconnectDatabase();
    if (err.code === 'EADDRINUSE') {
      throw new Error(`Port ${env.port} is already in use. Stop the other process or set a different PORT in .env.`);
    }
    throw err;
  });
  logger.info({ port: env.port, env: env.nodeEnv }, 'Shikaku server listening');

  let shuttingDown = false;
  const shutdown = async (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await new Promise((resolve) => io.close(() => resolve())); // also closes the HTTP server
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(exitCode);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException', 1);
  });
}

start().catch((err) => {
  logger.fatal({ err: err.message }, 'Failed to start server');
  process.exit(1);
});

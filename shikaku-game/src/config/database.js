'use strict';

const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;

mongoose.set('strictQuery', true);

let listenersAttached = false;

function attachConnectionListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  const { connection } = mongoose;
  connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  connection.on('error', (err) => logger.error({ err: err.message }, 'MongoDB connection error'));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Connects with bounded retries so a slow-starting database (e.g. in Docker) doesn't crash startup. */
async function connectDatabase(uri = env.mongodbUri) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      attachConnectionListeners(); // only report runtime drops, not failed startup attempts
      logger.info({ host: mongoose.connection.host, db: mongoose.connection.name }, 'MongoDB connected');
      return mongoose.connection;
    } catch (err) {
      logger.warn({ attempt, maxAttempts: MAX_ATTEMPTS, err: err.message }, 'MongoDB connection attempt failed');
      if (attempt === MAX_ATTEMPTS) throw new Error('Unable to connect to MongoDB. Check MONGODB_URI.');
      await wait(RETRY_DELAY_MS * attempt);
    }
  }
  return mongoose.connection;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB connection closed');
  }
}

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

function getDatabaseStatus() {
  return STATES[mongoose.connection.readyState] || 'unknown';
}

module.exports = { connectDatabase, disconnectDatabase, getDatabaseStatus };

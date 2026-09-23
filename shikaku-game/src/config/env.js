'use strict';

require('dotenv').config({ quiet: true });
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/shikaku'),
  // Comma-separated list of extra origins allowed for CORS / Socket.IO.
  // The app's own origin always works because the frontend is same-origin.
  CLIENT_URL: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Only report which variables are wrong — never print their values.
  const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Invalid environment configuration: ${fields}`);
}

const raw = parsed.data;

const env = Object.freeze({
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  port: raw.PORT,
  mongodbUri: raw.MONGODB_URI,
  clientUrls: raw.CLIENT_URL.split(',').map((url) => url.trim().replace(/\/$/, '')).filter(Boolean),
  logLevel: raw.LOG_LEVEL || (raw.NODE_ENV === 'test' ? 'silent' : 'info'),
});

module.exports = env;

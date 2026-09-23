'use strict';

const crypto = require('node:crypto');

/** Random integer in [min, max] (inclusive). `rng` returns a float in [0, 1). */
function randomInt(min, max, rng = Math.random) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pickRandom(items, rng = Math.random) {
  return items[Math.floor(rng() * items.length)];
}

/** Picks an item using `weightOf(item)` as its relative probability. */
function pickWeighted(items, weightOf, rng = Math.random) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  if (total <= 0) return pickRandom(items, rng);
  let threshold = rng() * total;
  for (const item of items) {
    threshold -= weightOf(item);
    if (threshold < 0) return item;
  }
  return items[items.length - 1];
}

/** Fisher–Yates shuffle returning a new array. */
function shuffle(items, rng = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Deterministic PRNG (mulberry32) — used by tests for reproducible puzzles. */
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function seededRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateId(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString('hex')}`;
}

function generateGameId() {
  return crypto.randomUUID();
}

module.exports = { randomInt, pickRandom, pickWeighted, shuffle, createSeededRandom, generateId, generateGameId };

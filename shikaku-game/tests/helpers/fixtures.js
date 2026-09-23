'use strict';

const { EventEmitter } = require('node:events');
const { createGameService } = require('../../src/services/game.service');
const { createInMemoryRepository } = require('./in-memory-repository');
const { createSeededRandom } = require('../../src/utils/random');

/** Controllable clock for timer tests. */
function createClock(start = '2026-01-01T10:00:00.000Z') {
  let now = new Date(start).getTime();
  const clock = () => new Date(now);
  clock.advance = (seconds) => {
    now += seconds * 1000;
  };
  return clock;
}

function createTestService({ seed = 42, clock = createClock() } = {}) {
  const repository = createInMemoryRepository();
  const events = new EventEmitter();
  const service = createGameService({ repository, events, clock, rng: createSeededRandom(seed) });
  return { service, repository, events, clock };
}

/** Places every rectangle on its solution slot (uses server-side data). */
async function solveGame(service, repository, gameId) {
  const { rectangles } = repository.raw(gameId);
  let last;
  for (const rect of rectangles) {
    last = await service.placeRectangle(gameId, { rectangleId: rect.id, row: rect.solution.row, col: rect.solution.col });
  }
  return last;
}

module.exports = { createClock, createTestService, solveGame };

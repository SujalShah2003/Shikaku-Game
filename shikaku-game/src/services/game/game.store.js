'use strict';

const { createError } = require('../../utils/errors');

const MAX_SAVE_RETRIES = 5;

/** Loading and optimistic-concurrency saving of game documents. */
function createGameStore({ repository, clock, logger }) {
  async function load(gameId) {
    const game = await repository.findByGameId(gameId);
    if (!game) throw createError('GAME_NOT_FOUND');
    return game;
  }

  /**
   * Read → modify → conditional write, retried on version conflicts so two
   * clients acting at once never clobber each other. `mutator` must be
   * synchronous; it may return { skipSave: true } for read-only outcomes.
   */
  async function mutate(gameId, mutator) {
    for (let attempt = 1; attempt <= MAX_SAVE_RETRIES; attempt += 1) {
      const game = await load(gameId);
      const now = clock();
      const result = mutator(game, now) || {};
      if (result.skipSave) return { game, result, now };
      const saved = await repository.updateIfVersion(game);
      if (saved) return { game: saved, result, now };
      logger.debug({ gameId, attempt }, 'Version conflict, retrying');
    }
    throw createError('CONCURRENT_UPDATE');
  }

  return { load, mutate };
}

module.exports = { createGameStore, MAX_SAVE_RETRIES };

'use strict';

/** Test double with the same contract as the Mongo repository (incl. optimistic concurrency). */
function createInMemoryRepository() {
  const store = new Map();
  const clone = (value) => (value ? structuredClone(value) : null);

  return {
    store,
    async create(game) {
      const now = new Date();
      const record = { ...clone(game), version: 0, createdAt: now, updatedAt: now };
      store.set(game.gameId, record);
      return clone(record);
    },
    async findByGameId(gameId) {
      return clone(store.get(gameId));
    },
    async updateIfVersion(game) {
      const current = store.get(game.gameId);
      if (!current || current.version !== game.version) return null;
      const record = { ...clone(game), version: current.version + 1, createdAt: current.createdAt, updatedAt: new Date() };
      store.set(game.gameId, record);
      return clone(record);
    },
    /** Server-side view (with solutions) — only tests may peek at this. */
    raw(gameId) {
      return clone(store.get(gameId));
    },
  };
}

module.exports = { createInMemoryRepository };

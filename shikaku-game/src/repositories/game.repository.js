'use strict';

const Game = require('../models/game.model');

/**
 * Persistence boundary. Services work with plain objects; this repository maps
 * them to MongoDB and enforces optimistic concurrency through the `__v` field
 * so concurrent clients never silently overwrite each other.
 */
const PERSISTED_FIELDS = [
  'rows',
  'columns',
  'difficulty',
  'status',
  'clues',
  'rectangles',
  'selectedRectangle',
  'startedAt',
  'endedAt',
  'elapsedSeconds',
  'moves',
  'puzzle',
];

function pickPersisted(game) {
  return Object.fromEntries(PERSISTED_FIELDS.map((field) => [field, game[field]]));
}

function toPlain(doc) {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc;
  return { ...rest, version: __v };
}

const gameRepository = {
  async create(game) {
    const doc = await Game.create({ gameId: game.gameId, ...pickPersisted(game) });
    return toPlain(doc.toObject({ transform: false }));
  },

  async findByGameId(gameId) {
    return toPlain(await Game.findOne({ gameId }).lean());
  },

  /** Saves only if nobody else saved since `game.version` was read. Returns null on conflict. */
  async updateIfVersion(game) {
    const updated = await Game.findOneAndUpdate(
      { gameId: game.gameId, __v: game.version },
      { $set: pickPersisted(game), $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    return toPlain(updated);
  },
};

module.exports = gameRepository;

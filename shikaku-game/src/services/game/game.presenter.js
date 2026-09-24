'use strict';

const { getTimerState } = require('../timer');
const { getProgress } = require('../validation');

/** The anchor cell being drawn from; ignores legacy string values from older saved games. */
function toCell(value) {
  return value && Number.isInteger(value.row) && Number.isInteger(value.col) ? { row: value.row, col: value.col } : null;
}

/** Only locked rectangles are public: unlocked ones would reveal the solution's shapes. */
function toPublicRectangles(rectangles) {
  return rectangles
    .filter((r) => r.locked && r.currentPosition)
    .map((r) => ({
      id: r.id,
      width: r.width,
      height: r.height,
      area: r.area,
      status: r.status,
      locked: true,
      currentPosition: { row: r.currentPosition.row, col: r.currentPosition.col },
    }));
}

/** The only shape of a game that ever leaves the server: no solution slots, no clue ownership. */
function toPublicGame(game, now = new Date()) {
  const timer = getTimerState(game, now);
  return {
    gameId: game.gameId,
    rows: game.rows,
    columns: game.columns,
    difficulty: game.difficulty,
    status: game.status,
    clues: game.clues.map(({ id, row, col, value }) => ({ id, row, col, value })),
    rectangles: toPublicRectangles(game.rectangles),
    selectedRectangle: toCell(game.selectedRectangle),
    moves: game.moves || 0,
    progress: getProgress(game),
    timer,
    startedAt: game.startedAt || null,
    endedAt: game.endedAt || null,
    elapsedSeconds: timer.elapsedSeconds,
    uniqueSolution: Boolean(game.puzzle && game.puzzle.uniqueSolution),
    version: game.version ?? 0,
    createdAt: game.createdAt || null,
    updatedAt: game.updatedAt || null,
  };
}

module.exports = { toCell, toPublicGame };

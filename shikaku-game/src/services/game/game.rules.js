'use strict';

const { GAME_STATUS, RECTANGLE_STATUS } = require('../../config/game.config');
const { createError } = require('../../utils/errors');
const puzzleService = require('../puzzle');
const rectangleService = require('../rectangle');
const timerService = require('../timer');

/** State changes on a loaded game document. All synchronous; nothing here touches storage. */

function assertNotCompleted(game) {
  if (game.status === GAME_STATUS.COMPLETED) throw createError('GAME_ALREADY_COMPLETED');
}

function assertPlayable(game) {
  assertNotCompleted(game);
  if (game.status !== GAME_STATUS.PLAYING) throw createError('INVALID_GAME_STATE', 'Start the game before moving rectangles.');
  if (!timerService.isTimerRunning(game)) throw createError('INVALID_GAME_STATE', 'The game is paused. Resume to keep playing.');
}

function rectangleAtCell(game, row, col) {
  return game.rectangles.find((r) => rectangleService.cellInBox(r.solution, row, col)) || null;
}

function clearSelection(game) {
  game.rectangles.forEach((r) => {
    if (r.status === RECTANGLE_STATUS.SELECTED) rectangleService.transition(r, RECTANGLE_STATUS.AVAILABLE);
  });
  game.selectedRectangle = null;
}

function completeGame(game, now) {
  game.status = GAME_STATUS.COMPLETED;
  timerService.stopTimer(game, now);
  clearSelection(game);
}

/** Replaces the board with a freshly generated puzzle and resets all progress. */
function applyNewPuzzle(game, now, { rng, config, logger }) {
  const puzzle = puzzleService.generatePuzzle(game.rows, game.columns, game.difficulty, { rng, config });
  game.clues = puzzle.clues;
  game.rectangles = puzzle.rectangles.map((rect) => ({
    ...rect,
    currentPosition: null,
    status: RECTANGLE_STATUS.AVAILABLE,
    selected: false,
    locked: false,
  }));
  game.puzzle = { uniqueSolution: puzzle.uniqueSolution, generationAttempts: puzzle.attempts, generatedAt: now };
  game.selectedRectangle = null;
  game.moves = 0;
  game.status = GAME_STATUS.CREATED;
  timerService.resetTimer(game);
  logger.info(
    { gameId: game.gameId, rows: game.rows, columns: game.columns, rectangles: puzzle.rectangles.length, uniqueSolution: puzzle.uniqueSolution },
    'Puzzle generated',
  );
  return game;
}

module.exports = { assertNotCompleted, assertPlayable, rectangleAtCell, clearSelection, completeGame, applyNewPuzzle };

'use strict';

const { EventEmitter } = require('node:events');
const { GAME_CONFIG, GAME_STATUS, RECTANGLE_STATUS } = require('../../config/game.config');
const { createError } = require('../../utils/errors');
const { generateGameId } = require('../../utils/random');
const defaultLogger = require('../../utils/logger');
const rectangleService = require('../rectangle');
const validationService = require('../validation');
const timerService = require('../timer');
const { GAME_EVENTS } = require('./game.events');
const { resolveBoardSize } = require('./board-size');
const { toPublicGame } = require('./game.presenter');
const { createGameStore } = require('./game.store');
const rules = require('./game.rules');

function winPayload(game) {
  return { game, elapsedSeconds: game.elapsedSeconds, moves: game.moves, rectangles: game.progress.total };
}

function createGameService({
  repository,
  events = new EventEmitter(),
  clock = () => new Date(),
  rng = Math.random,
  config = GAME_CONFIG,
  logger = defaultLogger,
} = {}) {
  if (!repository) throw new Error('createGameService requires a repository');

  const store = createGameStore({ repository, clock, logger });
  const puzzleOptions = { rng, config, logger };
  const emit = (event, gameId, payload) => events.emit(event, { gameId, ...payload });

  /** Runs a mutation and returns the public view of the resulting game. */
  async function run(gameId, mutator) {
    const { game, result, now } = await store.mutate(gameId, mutator);
    return { game: toPublicGame(game, now), result };
  }

  async function createGame(options = {}) {
    const size = resolveBoardSize(options, config);
    const now = clock();
    const game = { gameId: generateGameId(), ...size, status: GAME_STATUS.CREATED, clues: [], rectangles: [] };
    rules.applyNewPuzzle(game, now, puzzleOptions);
    const saved = await repository.create(game);
    logger.info({ gameId: saved.gameId, difficulty: size.difficulty, rows: size.rows, columns: size.columns }, 'Game created');
    return toPublicGame(saved, now);
  }

  async function getGame(gameId) {
    return toPublicGame(await store.load(gameId), clock());
  }

  async function generatePuzzle(gameId) {
    const { game } = await run(gameId, (current, time) => {
      if (current.status !== GAME_STATUS.CREATED) {
        throw createError('INVALID_GAME_STATE', 'A puzzle can only be regenerated before the game starts. Use reset instead.');
      }
      rules.applyNewPuzzle(current, time, puzzleOptions);
    });
    emit(GAME_EVENTS.UPDATED, gameId, { game });
    return game;
  }

  async function startGame(gameId) {
    const { game, result } = await run(gameId, (current, time) => {
      rules.assertNotCompleted(current);
      if (current.status === GAME_STATUS.PLAYING && timerService.isTimerRunning(current)) return { skipSave: true };
      const resumed = current.status === GAME_STATUS.PLAYING;
      current.status = GAME_STATUS.PLAYING;
      timerService.startTimer(current, time);
      return { resumed };
    });
    if (!result.skipSave) {
      logger.info({ gameId, resumed: result.resumed }, result.resumed ? 'Game resumed' : 'Game started');
      emit(GAME_EVENTS.STARTED, gameId, { game, resumed: result.resumed });
      emit(GAME_EVENTS.TIMER_UPDATED, gameId, { timer: game.timer });
      emit(GAME_EVENTS.UPDATED, gameId, { game });
    }
    return game;
  }

  /**
   * The player pressed on a cell to start drawing a rectangle. The anchor cell
   * is persisted and broadcast so teammates can see where someone is drawing;
   * server-side, the hidden solution rectangle under it becomes "selected".
   */
  async function selectRectangle(gameId, { row, col }) {
    const { game, result } = await run(gameId, (current) => {
      rules.assertPlayable(current);
      if (!rectangleService.isPositionOnBoard({ row, col }, current.rows, current.columns)) {
        throw createError('INVALID_POSITION', 'That cell is not on the board.');
      }
      const rectangle = rules.rectangleAtCell(current, row, col);
      if (rectangle.locked) throw createError('RECTANGLE_ALREADY_LOCKED', 'That cell is already part of a locked rectangle.');
      const anchor = current.selectedRectangle;
      if (anchor && anchor.row === row && anchor.col === col) return { skipSave: true };
      rules.clearSelection(current);
      rectangleService.transition(rectangle, RECTANGLE_STATUS.SELECTED);
      current.selectedRectangle = { row, col };
      return {};
    });
    if (!result.skipSave) {
      logger.info({ gameId, row, col }, 'Rectangle selected');
      emit(GAME_EVENTS.RECTANGLE_SELECTED, gameId, { game, selection: game.selectedRectangle });
      emit(GAME_EVENTS.UPDATED, gameId, { game });
    }
    return game;
  }

  /**
   * Attempts to place a rectangle the player drew ({ row, col, width, height }).
   * Rule violations are a normal game outcome (they count as a move and are
   * persisted), so they are returned as `placement.accepted = false` instead of
   * thrown; the REST layer maps them to 422.
   */
  async function placeRectangle(gameId, { row, col, width, height }) {
    const drawn = { row, col, width, height };
    const { game, result } = await run(gameId, (current, time) => {
      rules.assertPlayable(current);
      current.moves = (current.moves || 0) + 1;
      rules.clearSelection(current);

      const verdict = rectangleService.validatePlacement(current, drawn, config);
      if (!verdict.valid) return { accepted: false, code: verdict.code, message: verdict.message };

      const { rectangle } = verdict;
      rectangleService.transition(rectangle, RECTANGLE_STATUS.PLACED);
      rectangleService.lockRectangle(rectangle, drawn);
      const { solved } = validationService.checkSolved(current);
      if (solved) rules.completeGame(current, time);
      return { accepted: true, solved, rectangleId: rectangle.id };
    });

    const placement = result.accepted
      ? { ...drawn, accepted: true, rectangleId: result.rectangleId }
      : { ...drawn, accepted: false, code: result.code, message: result.message };
    if (result.accepted) {
      logger.info({ gameId, rectangleId: result.rectangleId, box: drawn }, 'Rectangle locked');
    } else {
      logger.warn({ gameId, box: drawn, code: result.code }, 'Invalid rectangle placement');
    }

    emit(GAME_EVENTS.RECTANGLE_MOVED, gameId, { game, placement });
    if (result.accepted) {
      const rectangle = game.rectangles.find((r) => r.id === result.rectangleId);
      emit(GAME_EVENTS.RECTANGLE_LOCKED, gameId, { game, rectangle });
    }
    emit(GAME_EVENTS.UPDATED, gameId, { game });
    if (result.solved) {
      logger.info({ gameId, elapsedSeconds: game.elapsedSeconds, moves: game.moves }, 'Puzzle completed');
      emit(GAME_EVENTS.TIMER_UPDATED, gameId, { timer: game.timer });
      emit(GAME_EVENTS.WON, gameId, winPayload(game));
    }
    return { game, placement, solved: Boolean(result.solved) };
  }

  async function checkWin(gameId) {
    const { game, result } = await run(gameId, (current, time) => {
      if (current.status === GAME_STATUS.COMPLETED) return { skipSave: true, solved: true };
      const { solved, reason } = validationService.checkSolved(current);
      if (!solved) return { skipSave: true, solved: false, reason };
      rules.completeGame(current, time);
      return { solved: true, newlyCompleted: true };
    });
    if (result.newlyCompleted) {
      logger.info({ gameId, elapsedSeconds: game.elapsedSeconds }, 'Puzzle completed');
      emit(GAME_EVENTS.UPDATED, gameId, { game });
      emit(GAME_EVENTS.WON, gameId, winPayload(game));
    }
    return {
      solved: result.solved,
      message: result.solved ? 'Congratulations! Puzzle solved.' : `Not solved yet: ${result.reason}`,
      elapsedSeconds: game.elapsedSeconds,
      game,
    };
  }

  /** Generates a brand-new puzzle (optionally with a new difficulty/size) and resets all progress. */
  async function resetGame(gameId, options = {}) {
    const { game } = await run(gameId, (current, time) => {
      const keepSize = !options.difficulty;
      const size = resolveBoardSize(
        {
          difficulty: options.difficulty || current.difficulty,
          rows: options.rows ?? (keepSize ? current.rows : undefined),
          columns: options.columns ?? (keepSize ? current.columns : undefined),
        },
        config,
      );
      Object.assign(current, size);
      rules.applyNewPuzzle(current, time, puzzleOptions);
    });
    logger.info({ gameId, difficulty: game.difficulty }, 'Game reset');
    emit(GAME_EVENTS.RESET, gameId, { game });
    emit(GAME_EVENTS.TIMER_UPDATED, gameId, { timer: game.timer });
    emit(GAME_EVENTS.UPDATED, gameId, { game });
    return game;
  }

  async function stopTimer(gameId) {
    const { game, result } = await run(gameId, (current, time) => {
      if (current.status === GAME_STATUS.CREATED) throw createError('INVALID_GAME_STATE', 'The timer has not started yet.');
      if (!timerService.isTimerRunning(current)) return { skipSave: true };
      timerService.stopTimer(current, time);
      return {};
    });
    if (!result.skipSave) {
      logger.info({ gameId, elapsedSeconds: game.elapsedSeconds }, 'Timer stopped');
      emit(GAME_EVENTS.TIMER_UPDATED, gameId, { timer: game.timer });
      emit(GAME_EVENTS.UPDATED, gameId, { game });
    }
    return { elapsedSeconds: game.elapsedSeconds, game };
  }

  return {
    events,
    createGame,
    getGame,
    generatePuzzle,
    startGame,
    selectRectangle,
    placeRectangle,
    checkWin,
    resetGame,
    stopTimer,
  };
}

module.exports = { createGameService };

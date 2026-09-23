'use strict';

const { EventEmitter } = require('node:events');
const { GAME_CONFIG, GAME_STATUS, RECTANGLE_STATUS } = require('../config/game.config');
const { createError } = require('../utils/errors');
const { generateGameId } = require('../utils/random');
const defaultLogger = require('../utils/logger');
const puzzleService = require('./puzzle.service');
const rectangleService = require('./rectangle.service');
const validationService = require('./validation.service');
const timerService = require('./timer.service');

const MAX_SAVE_RETRIES = 5;

/** Server → client event names. The socket layer relays these to `game:{gameId}` rooms. */
const GAME_EVENTS = Object.freeze({
  STARTED: 'game:started',
  UPDATED: 'game:updated',
  RECTANGLE_SELECTED: 'rectangle:selected',
  RECTANGLE_MOVED: 'rectangle:moved',
  RECTANGLE_LOCKED: 'rectangle:locked',
  RESET: 'game:reset',
  WON: 'game:won',
  TIMER_UPDATED: 'timer:updated',
});

function resolveBoardSize({ difficulty, rows, columns }, config = GAME_CONFIG) {
  const level = difficulty || config.defaultDifficulty;
  const preset = config.difficulties[level];
  if (!preset) throw createError('INVALID_DIFFICULTY', `Difficulty must be one of: ${Object.keys(config.difficulties).join(', ')}.`);

  const size = { difficulty: level, rows: rows ?? preset.rows, columns: columns ?? preset.columns };
  const validRows = Number.isInteger(size.rows) && size.rows >= config.minRows && size.rows <= config.maxRows;
  const validColumns = Number.isInteger(size.columns) && size.columns >= config.minColumns && size.columns <= config.maxColumns;
  if (!validRows || !validColumns) {
    throw createError(
      'INVALID_BOARD_SIZE',
      `Board must be between ${config.minRows}×${config.minColumns} and ${config.maxRows}×${config.maxColumns}.`,
    );
  }
  return size;
}

/** The only shape of a game that ever leaves the server: no solution slots, no clue ownership. */
function toPublicGame(game, now = new Date()) {
  const timer = timerService.getTimerState(game, now);
  return {
    gameId: game.gameId,
    rows: game.rows,
    columns: game.columns,
    difficulty: game.difficulty,
    status: game.status,
    clues: game.clues.map(({ id, row, col, value }) => ({ id, row, col, value })),
    rectangles: game.rectangles.map((r) => ({
      id: r.id,
      width: r.width,
      height: r.height,
      area: r.area,
      status: r.status,
      selected: r.selected,
      locked: r.locked,
      currentPosition: r.locked && r.currentPosition ? { row: r.currentPosition.row, col: r.currentPosition.col } : null,
    })),
    selectedRectangle: game.selectedRectangle || null,
    moves: game.moves || 0,
    progress: validationService.getProgress(game),
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

function createGameService({
  repository,
  events = new EventEmitter(),
  clock = () => new Date(),
  rng = Math.random,
  config = GAME_CONFIG,
  logger = defaultLogger,
} = {}) {
  if (!repository) throw new Error('createGameService requires a repository');

  const emit = (event, gameId, payload) => events.emit(event, { gameId, ...payload });

  function applyNewPuzzle(game, now) {
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

  /**
   * Read → modify → conditional write, retried on version conflicts so two
   * clients acting at once never clobber each other. `mutator` must be
   * synchronous; it may return { skipSave: true } for read-only outcomes.
   */
  async function mutate(gameId, mutator) {
    for (let attempt = 1; attempt <= MAX_SAVE_RETRIES; attempt += 1) {
      const game = await repository.findByGameId(gameId);
      if (!game) throw createError('GAME_NOT_FOUND');
      const now = clock();
      const result = mutator(game, now) || {};
      if (result.skipSave) return { game, result, now };
      const saved = await repository.updateIfVersion(game);
      if (saved) return { game: saved, result, now };
      logger.debug({ gameId, attempt }, 'Version conflict, retrying');
    }
    throw createError('CONCURRENT_UPDATE');
  }

  function assertNotCompleted(game) {
    if (game.status === GAME_STATUS.COMPLETED) throw createError('GAME_ALREADY_COMPLETED');
  }

  function assertPlayable(game) {
    assertNotCompleted(game);
    if (game.status !== GAME_STATUS.PLAYING) throw createError('INVALID_GAME_STATE', 'Start the game before moving rectangles.');
    if (!timerService.isTimerRunning(game)) throw createError('INVALID_GAME_STATE', 'The game is paused. Resume to keep playing.');
  }

  function findRectangle(game, rectangleId) {
    const rectangle = game.rectangles.find((r) => r.id === rectangleId);
    if (!rectangle) throw createError('RECTANGLE_NOT_FOUND');
    return rectangle;
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

  function winPayload(game) {
    return { game, elapsedSeconds: game.elapsedSeconds, moves: game.moves, rectangles: game.progress.total };
  }

  async function createGame(options = {}) {
    const size = resolveBoardSize(options, config);
    const now = clock();
    const game = { gameId: generateGameId(), ...size, status: GAME_STATUS.CREATED, clues: [], rectangles: [] };
    applyNewPuzzle(game, now);
    const saved = await repository.create(game);
    logger.info({ gameId: saved.gameId, difficulty: size.difficulty, rows: size.rows, columns: size.columns }, 'Game created');
    return toPublicGame(saved, now);
  }

  async function getGame(gameId) {
    const game = await repository.findByGameId(gameId);
    if (!game) throw createError('GAME_NOT_FOUND');
    return toPublicGame(game, clock());
  }

  async function generatePuzzle(gameId) {
    const { game, now } = await mutate(gameId, (current, time) => {
      if (current.status !== GAME_STATUS.CREATED) {
        throw createError('INVALID_GAME_STATE', 'A puzzle can only be regenerated before the game starts. Use reset instead.');
      }
      applyNewPuzzle(current, time);
    });
    const publicGame = toPublicGame(game, now);
    emit(GAME_EVENTS.UPDATED, gameId, { game: publicGame });
    return publicGame;
  }

  async function startGame(gameId) {
    const { game, result, now } = await mutate(gameId, (current, time) => {
      assertNotCompleted(current);
      if (current.status === GAME_STATUS.PLAYING && timerService.isTimerRunning(current)) return { skipSave: true };
      const resumed = current.status === GAME_STATUS.PLAYING;
      current.status = GAME_STATUS.PLAYING;
      timerService.startTimer(current, time);
      return { resumed };
    });
    const publicGame = toPublicGame(game, now);
    if (!result.skipSave) {
      logger.info({ gameId, resumed: result.resumed }, result.resumed ? 'Game resumed' : 'Game started');
      emit(GAME_EVENTS.STARTED, gameId, { game: publicGame, resumed: result.resumed });
      emit(GAME_EVENTS.TIMER_UPDATED, gameId, { timer: publicGame.timer });
      emit(GAME_EVENTS.UPDATED, gameId, { game: publicGame });
    }
    return publicGame;
  }

  async function selectRectangle(gameId, rectangleId) {
    const { game, now } = await mutate(gameId, (current) => {
      assertPlayable(current);
      const rectangle = findRectangle(current, rectangleId);
      if (rectangle.locked) throw createError('RECTANGLE_ALREADY_LOCKED');
      if (rectangle.status === RECTANGLE_STATUS.SELECTED) return { skipSave: true };
      clearSelection(current);
      rectangleService.transition(rectangle, RECTANGLE_STATUS.SELECTED);
      current.selectedRectangle = rectangle.id;
      return {};
    });
    const publicGame = toPublicGame(game, now);
    logger.info({ gameId, rectangleId }, 'Rectangle selected');
    emit(GAME_EVENTS.RECTANGLE_SELECTED, gameId, { game: publicGame, rectangleId });
    emit(GAME_EVENTS.UPDATED, gameId, { game: publicGame });
    return publicGame;
  }

  /**
   * Attempts a placement. Rule violations are a normal game outcome (they count
   * as a move and are persisted), so they are returned as `placement.accepted =
   * false` instead of thrown; the REST layer maps them to 422.
   */
  async function placeRectangle(gameId, { rectangleId, row, col }) {
    const position = { row, col };
    const { game, result, now } = await mutate(gameId, (current, time) => {
      assertPlayable(current);
      const rectangle = findRectangle(current, rectangleId);
      if (rectangle.locked) throw createError('RECTANGLE_ALREADY_LOCKED');

      current.moves = (current.moves || 0) + 1;
      if (current.selectedRectangle === rectangle.id) current.selectedRectangle = null;
      rectangleService.transition(rectangle, RECTANGLE_STATUS.PLACED);
      rectangle.currentPosition = position;

      const verdict = rectangleService.validatePlacement(current, rectangle, position);
      if (!verdict.valid) {
        rectangleService.transition(rectangle, RECTANGLE_STATUS.AVAILABLE);
        rectangle.currentPosition = null;
        return { accepted: false, code: verdict.code, message: verdict.message };
      }

      rectangleService.lockRectangle(rectangle, position, verdict.match);
      const solved = validationService.checkSolved(current).solved;
      if (solved) completeGame(current, time);
      return { accepted: true, solved };
    });

    const publicGame = toPublicGame(game, now);
    const placement = { rectangleId, position, accepted: result.accepted };
    if (!result.accepted) {
      placement.code = result.code;
      placement.message = result.message;
      logger.warn({ gameId, rectangleId, position, code: result.code }, 'Invalid rectangle placement');
    } else {
      logger.info({ gameId, rectangleId, position }, 'Rectangle locked');
    }

    emit(GAME_EVENTS.RECTANGLE_MOVED, gameId, { game: publicGame, ...placement });
    if (result.accepted) emit(GAME_EVENTS.RECTANGLE_LOCKED, gameId, { game: publicGame, rectangleId, position });
    emit(GAME_EVENTS.UPDATED, gameId, { game: publicGame });
    if (result.solved) {
      logger.info({ gameId, elapsedSeconds: publicGame.elapsedSeconds, moves: publicGame.moves }, 'Puzzle completed');
      emit(GAME_EVENTS.TIMER_UPDATED, gameId, { timer: publicGame.timer });
      emit(GAME_EVENTS.WON, gameId, winPayload(publicGame));
    }
    return { game: publicGame, placement, solved: Boolean(result.solved) };
  }

  async function checkWin(gameId) {
    const { game, result, now } = await mutate(gameId, (current, time) => {
      if (current.status === GAME_STATUS.COMPLETED) return { skipSave: true, solved: true };
      const { solved, reason } = validationService.checkSolved(current);
      if (!solved) return { skipSave: true, solved: false, reason };
      completeGame(current, time);
      return { solved: true, newlyCompleted: true };
    });
    const publicGame = toPublicGame(game, now);
    if (result.newlyCompleted) {
      logger.info({ gameId, elapsedSeconds: publicGame.elapsedSeconds }, 'Puzzle completed');
      emit(GAME_EVENTS.UPDATED, gameId, { game: publicGame });
      emit(GAME_EVENTS.WON, gameId, winPayload(publicGame));
    }
    return {
      solved: result.solved,
      message: result.solved ? 'Congratulations! Puzzle solved.' : `Not solved yet: ${result.reason}`,
      elapsedSeconds: publicGame.elapsedSeconds,
      game: publicGame,
    };
  }

  /** Generates a brand-new puzzle (optionally with a new difficulty/size) and resets all progress. */
  async function resetGame(gameId, options = {}) {
    const { game, now } = await mutate(gameId, (current, time) => {
      const size = resolveBoardSize(
        {
          difficulty: options.difficulty || current.difficulty,
          rows: options.rows ?? (options.difficulty ? undefined : current.rows),
          columns: options.columns ?? (options.difficulty ? undefined : current.columns),
        },
        config,
      );
      Object.assign(current, size);
      applyNewPuzzle(current, time);
    });
    const publicGame = toPublicGame(game, now);
    logger.info({ gameId, difficulty: publicGame.difficulty }, 'Game reset');
    emit(GAME_EVENTS.RESET, gameId, { game: publicGame });
    emit(GAME_EVENTS.TIMER_UPDATED, gameId, { timer: publicGame.timer });
    emit(GAME_EVENTS.UPDATED, gameId, { game: publicGame });
    return publicGame;
  }

  async function stopTimer(gameId) {
    const { game, result, now } = await mutate(gameId, (current, time) => {
      if (current.status === GAME_STATUS.CREATED) throw createError('INVALID_GAME_STATE', 'The timer has not started yet.');
      if (!timerService.isTimerRunning(current)) return { skipSave: true };
      timerService.stopTimer(current, time);
      return {};
    });
    const publicGame = toPublicGame(game, now);
    if (!result.skipSave) {
      logger.info({ gameId, elapsedSeconds: publicGame.elapsedSeconds }, 'Timer stopped');
      emit(GAME_EVENTS.TIMER_UPDATED, gameId, { timer: publicGame.timer });
      emit(GAME_EVENTS.UPDATED, gameId, { game: publicGame });
    }
    return { elapsedSeconds: publicGame.elapsedSeconds, game: publicGame };
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

module.exports = { createGameService, toPublicGame, resolveBoardSize, GAME_EVENTS };

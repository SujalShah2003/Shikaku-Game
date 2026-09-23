'use strict';

class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Error catalogue: one place defining every code, its HTTP status and default message. */
const ERRORS = Object.freeze({
  VALIDATION_ERROR: [400, 'Request validation failed.'],
  INVALID_BOARD_SIZE: [400, 'Board size is outside the allowed limits.'],
  INVALID_DIFFICULTY: [400, 'Unknown difficulty.'],
  INVALID_GAME_ID: [400, 'Invalid game ID.'],
  INVALID_RECTANGLE_ID: [400, 'Invalid rectangle ID.'],
  INVALID_POSITION: [400, 'Position is outside the board.'],
  GAME_NOT_FOUND: [404, 'Game not found.'],
  RECTANGLE_NOT_FOUND: [404, 'Rectangle not found.'],
  RECTANGLE_ALREADY_LOCKED: [409, 'Rectangle is already locked.'],
  GAME_ALREADY_COMPLETED: [409, 'Game is already completed.'],
  INVALID_GAME_STATE: [409, 'Operation not allowed in the current game state.'],
  CONCURRENT_UPDATE: [409, 'The game was modified concurrently. Please retry.'],
  RECTANGLE_OUT_OF_BOARD: [422, 'Rectangle extends outside the board.'],
  RECTANGLE_OVERLAP: [422, 'Rectangle overlaps a locked rectangle.'],
  INVALID_PLACEMENT: [422, 'Invalid rectangle placement.'],
  INTERNAL_ERROR: [500, 'Something went wrong.'],
});

function createError(code, message, details) {
  const [statusCode, defaultMessage] = ERRORS[code] || ERRORS.INTERNAL_ERROR;
  return new AppError(statusCode, code, message || defaultMessage, details);
}

module.exports = { AppError, ERRORS, createError };

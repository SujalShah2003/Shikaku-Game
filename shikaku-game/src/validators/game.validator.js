'use strict';

const { z } = require('zod');
const { GAME_CONFIG, DIFFICULTIES } = require('../config/game.config');
const { createError } = require('../utils/errors');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const gameIdSchema = z.string().trim().regex(UUID_PATTERN, 'Game ID must be a valid UUID.');
const difficultySchema = z.enum(DIFFICULTIES, { message: `Difficulty must be one of: ${DIFFICULTIES.join(', ')}.` });

const rowsSchema = z
  .number({ message: 'Rows must be a number.' })
  .int('Rows must be an integer.')
  .min(GAME_CONFIG.minRows, `Rows must be at least ${GAME_CONFIG.minRows}.`)
  .max(GAME_CONFIG.maxRows, `Rows must be at most ${GAME_CONFIG.maxRows}.`);

const columnsSchema = z
  .number({ message: 'Columns must be a number.' })
  .int('Columns must be an integer.')
  .min(GAME_CONFIG.minColumns, `Columns must be at least ${GAME_CONFIG.minColumns}.`)
  .max(GAME_CONFIG.maxColumns, `Columns must be at most ${GAME_CONFIG.maxColumns}.`);

// Board-specific bounds are checked in the rectangle service; this rejects nonsense early.
const coordinate = (name, max) =>
  z.number({ message: `${name} must be a number.` }).int(`${name} must be an integer.`).min(0, `${name} cannot be negative.`).max(max - 1);

const boardOptionsSchema = z.object({
  difficulty: difficultySchema.optional(),
  rows: rowsSchema.optional(),
  columns: columnsSchema.optional(),
});

const size = (name, max) =>
  z.number({ message: `${name} must be a number.` }).int(`${name} must be an integer.`).min(1, `${name} must be at least 1.`).max(max);

const gameIdParamsSchema = z.object({ gameId: gameIdSchema });
// Selecting = pressing on the cell where a new rectangle starts.
const selectRectangleSchema = z.object({
  row: coordinate('Row', GAME_CONFIG.maxRows),
  col: coordinate('Column', GAME_CONFIG.maxColumns),
});
// Placing = the rectangle the player drew: top-left cell + size.
const placeRectangleSchema = selectRectangleSchema.extend({
  width: size('Width', GAME_CONFIG.maxColumns),
  height: size('Height', GAME_CONFIG.maxRows),
});

// Socket payloads carry the game ID alongside the action body.
const socketSchemas = {
  gameOnly: gameIdParamsSchema,
  reset: boardOptionsSchema.extend({ gameId: gameIdSchema }),
  select: selectRectangleSchema.extend({ gameId: gameIdSchema }),
  place: placeRectangleSchema.extend({ gameId: gameIdSchema }),
};

const FIELD_ERROR_CODES = {
  rows: 'INVALID_BOARD_SIZE',
  columns: 'INVALID_BOARD_SIZE',
  difficulty: 'INVALID_DIFFICULTY',
  gameId: 'INVALID_GAME_ID',
  row: 'INVALID_POSITION',
  col: 'INVALID_POSITION',
  width: 'INVALID_POSITION',
  height: 'INVALID_POSITION',
};

/** Parses `input` with `schema`, converting Zod issues into a domain AppError. */
function validate(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;

  const { issues } = result.error;
  const field = issues[0] && issues[0].path[0];
  const code = FIELD_ERROR_CODES[field] || 'VALIDATION_ERROR';
  const details = issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  throw createError(code, details[0] ? details[0].message : undefined, details);
}

module.exports = {
  validate,
  gameIdSchema,
  gameIdParamsSchema,
  boardOptionsSchema,
  createGameSchema: boardOptionsSchema,
  resetGameSchema: boardOptionsSchema,
  selectRectangleSchema,
  placeRectangleSchema,
  socketSchemas,
};

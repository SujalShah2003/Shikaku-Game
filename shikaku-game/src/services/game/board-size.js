'use strict';

const { GAME_CONFIG } = require('../../config/game.config');
const { createError } = require('../../utils/errors');

/** Difficulty preset merged with any explicit rows/columns, checked against the configured bounds. */
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

module.exports = { resolveBoardSize };

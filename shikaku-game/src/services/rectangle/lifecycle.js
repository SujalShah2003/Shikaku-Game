'use strict';

const { RECTANGLE_STATUS } = require('../../config/game.config');
const { createError } = require('../../utils/errors');

/** available ⇄ selected → placed → locked. Locked is final. */
const ALLOWED_TRANSITIONS = Object.freeze({
  [RECTANGLE_STATUS.AVAILABLE]: [RECTANGLE_STATUS.SELECTED, RECTANGLE_STATUS.PLACED],
  [RECTANGLE_STATUS.SELECTED]: [RECTANGLE_STATUS.AVAILABLE, RECTANGLE_STATUS.PLACED],
  [RECTANGLE_STATUS.PLACED]: [RECTANGLE_STATUS.LOCKED, RECTANGLE_STATUS.AVAILABLE],
  [RECTANGLE_STATUS.LOCKED]: [],
});

function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

function transition(rectangle, to) {
  if (!canTransition(rectangle.status, to)) {
    if (rectangle.status === RECTANGLE_STATUS.LOCKED) throw createError('RECTANGLE_ALREADY_LOCKED');
    throw createError('INVALID_GAME_STATE', `Rectangle cannot go from "${rectangle.status}" to "${to}".`);
  }
  rectangle.status = to;
  rectangle.selected = to === RECTANGLE_STATUS.SELECTED;
  rectangle.locked = to === RECTANGLE_STATUS.LOCKED;
  return rectangle;
}

/** Locks `rectangle` at `position` (its top-left cell). */
function lockRectangle(rectangle, position) {
  rectangle.currentPosition = { row: position.row, col: position.col };
  if (rectangle.status !== RECTANGLE_STATUS.PLACED) transition(rectangle, RECTANGLE_STATUS.PLACED);
  transition(rectangle, RECTANGLE_STATUS.LOCKED);
  return rectangle;
}

module.exports = { ALLOWED_TRANSITIONS, canTransition, transition, lockRectangle };

'use strict';

const { GAME_CONFIG, RECTANGLE_STATUS } = require('../config/game.config');
const { createError } = require('../utils/errors');

/**
 * Pure placement rules — no Express, no database. A "box" is
 * { row, col, width, height } with (row, col) being the top-left cell.
 */

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

function toBox(rectangle, position = rectangle.currentPosition) {
  return { row: position.row, col: position.col, width: rectangle.width, height: rectangle.height };
}

function isPositionOnBoard({ row, col }, rows, columns) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < rows && col < columns;
}

function isInsideBoard(box, rows, columns) {
  return isPositionOnBoard(box, rows, columns) && box.row + box.height <= rows && box.col + box.width <= columns;
}

function boxesOverlap(a, b) {
  return a.row < b.row + b.height && b.row < a.row + a.height && a.col < b.col + b.width && b.col < a.col + a.width;
}

function hasOverlap(box, otherBoxes) {
  return otherBoxes.some((other) => boxesOverlap(box, other));
}

function cellInBox(box, row, col) {
  return row >= box.row && row < box.row + box.height && col >= box.col && col < box.col + box.width;
}

function getCluesInside(box, clues) {
  return clues.filter((clue) => cellInBox(box, clue.row, clue.col));
}

/** True when the box contains exactly one clue (a Shikaku rectangle must). */
function containsClue(box, clues) {
  return getCluesInside(box, clues).length === 1;
}

function hasCorrectArea(box, clue) {
  return Boolean(clue) && box.width * box.height === clue.value;
}

/** True when `box` is exactly this rectangle's slot in the stored solution. */
function isCorrectSolutionPosition(rectangle, box) {
  const { solution } = rectangle;
  return (
    solution.row === box.row &&
    solution.col === box.col &&
    solution.width === (box.width ?? rectangle.width) &&
    solution.height === (box.height ?? rectangle.height)
  );
}

function hasAllowedDimensions(box, config = GAME_CONFIG) {
  return (
    box.width >= config.minRectangleWidth &&
    box.width <= config.maxRectangleWidth &&
    box.height >= config.minRectangleHeight &&
    box.height <= config.maxRectangleHeight
  );
}

function getLockedBoxes(rectangles) {
  return rectangles.filter((r) => r.locked).map((r) => toBox(r));
}

/** The unlocked solution rectangle occupying exactly `box`, if any. */
function findRectangleForBox(rectangles, box) {
  return rectangles.find((r) => !r.locked && isCorrectSolutionPosition(r, box)) || null;
}

function reject(code, message) {
  return { valid: false, code, message };
}

/**
 * Validates a rectangle the player drew: `box` = { row, col, width, height }
 * with (row, col) as its top-left cell.
 * Returns { valid: true, rectangle } (the solution rectangle it matches) or
 * { valid: false, code, message }.
 */
function validatePlacement(game, box, config = GAME_CONFIG) {
  const { rows, columns, clues, rectangles } = game;

  if (!isPositionOnBoard(box, rows, columns)) {
    return reject('INVALID_POSITION', 'That position is not on the board.');
  }
  if (!isInsideBoard(box, rows, columns)) {
    return reject('RECTANGLE_OUT_OF_BOARD', 'The rectangle would extend past the edge of the board.');
  }
  if (!hasAllowedDimensions(box, config)) {
    return reject(
      'INVALID_PLACEMENT',
      `Rectangles can be at most ${config.maxRectangleWidth} wide and ${config.maxRectangleHeight} tall.`,
    );
  }
  if (hasOverlap(box, getLockedBoxes(rectangles))) {
    return reject('RECTANGLE_OVERLAP', 'The rectangle overlaps a locked rectangle.');
  }
  const inside = getCluesInside(box, clues);
  if (inside.length === 0) {
    return reject('INVALID_PLACEMENT', 'A rectangle must cover exactly one number — this covers none.');
  }
  if (inside.length > 1) {
    return reject('INVALID_PLACEMENT', `A rectangle must cover exactly one number — this covers ${inside.length}.`);
  }
  if (!hasCorrectArea(box, inside[0])) {
    return reject('INVALID_PLACEMENT', `This rectangle has area ${box.width * box.height}, but the number is ${inside[0].value}.`);
  }
  const rectangle = findRectangleForBox(rectangles, box);
  if (!rectangle) {
    return reject('INVALID_PLACEMENT', 'This fits the number, but it blocks the rest of the puzzle. Try another shape.');
  }
  return { valid: true, rectangle };
}

/** Locks `rectangle` at `position` (its top-left cell). */
function lockRectangle(rectangle, position) {
  rectangle.currentPosition = { row: position.row, col: position.col };
  if (rectangle.status !== RECTANGLE_STATUS.PLACED) transition(rectangle, RECTANGLE_STATUS.PLACED);
  transition(rectangle, RECTANGLE_STATUS.LOCKED);
  return rectangle;
}

module.exports = {
  canTransition,
  transition,
  toBox,
  isPositionOnBoard,
  isInsideBoard,
  boxesOverlap,
  hasOverlap,
  cellInBox,
  getCluesInside,
  containsClue,
  hasCorrectArea,
  isCorrectSolutionPosition,
  hasAllowedDimensions,
  findRectangleForBox,
  validatePlacement,
  lockRectangle,
};

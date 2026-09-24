'use strict';

const { GAME_CONFIG } = require('../../config/game.config');
const {
  toBox,
  isPositionOnBoard,
  isInsideBoard,
  hasOverlap,
  getCluesInside,
  hasCorrectArea,
  hasAllowedDimensions,
} = require('./geometry');

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
 * with (row, col) as its top-left cell. Checks run cheapest-first.
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

module.exports = { isCorrectSolutionPosition, getLockedBoxes, findRectangleForBox, validatePlacement };

'use strict';

const { GAME_CONFIG } = require('../../config/game.config');

/**
 * Pure box geometry — no Express, no database. A "box" is
 * { row, col, width, height } with (row, col) being the top-left cell.
 */

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

function hasAllowedDimensions(box, config = GAME_CONFIG) {
  return (
    box.width >= config.minRectangleWidth &&
    box.width <= config.maxRectangleWidth &&
    box.height >= config.minRectangleHeight &&
    box.height <= config.maxRectangleHeight
  );
}

module.exports = {
  toBox,
  isPositionOnBoard,
  isInsideBoard,
  boxesOverlap,
  hasOverlap,
  cellInBox,
  getCluesInside,
  containsClue,
  hasCorrectArea,
  hasAllowedDimensions,
};

'use strict';

const { toBox, getCluesInside, isCorrectSolutionPosition } = require('../rectangle');
const { isValidPartition } = require('./partition');

/** Every box contains exactly one clue whose value equals the box area, and every clue is used once. */
function cluesMatchBoxes(boxes, clues) {
  const used = new Set();
  const everyBoxValid = boxes.every((box) => {
    const inside = getCluesInside(box, clues);
    if (inside.length !== 1 || inside[0].value !== box.width * box.height || used.has(inside[0].id)) return false;
    used.add(inside[0].id);
    return true;
  });
  return everyBoxValid && used.size === clues.length;
}

/**
 * Solved ⇔ every rectangle is locked, every rectangle sits on its solution slot,
 * nothing overlaps, the whole board is covered, and each rectangle holds exactly
 * one clue matching its area. The server never trusts the client for this.
 */
function checkSolved(game) {
  const { rows, columns, rectangles, clues } = game;
  if (rectangles.length === 0) return { solved: false, reason: 'The puzzle has not been generated.' };

  const unlocked = rectangles.filter((r) => !r.locked || !r.currentPosition).length;
  if (unlocked > 0) {
    return { solved: false, reason: `${unlocked} rectangle(s) still to place.` };
  }
  const boxes = rectangles.map((r) => toBox(r));
  if (!rectangles.every((r, i) => isCorrectSolutionPosition(r, boxes[i]))) {
    return { solved: false, reason: 'Some rectangles are not in their correct position.' };
  }
  if (!isValidPartition(rows, columns, boxes)) {
    return { solved: false, reason: 'Rectangles overlap or leave cells uncovered.' };
  }
  if (!cluesMatchBoxes(boxes, clues)) {
    return { solved: false, reason: 'Every rectangle must contain exactly one matching number.' };
  }
  return { solved: true, reason: null };
}

module.exports = { cluesMatchBoxes, checkSolved };

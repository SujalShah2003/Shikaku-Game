'use strict';

const { toBox, isInsideBoard, getCluesInside, isCorrectSolutionPosition } = require('./rectangle.service');

/**
 * Board-level checks. Used both to verify generated partitions and to decide
 * whether a game is solved — the server never trusts the client for either.
 */
function analyzePartition(rows, columns, boxes) {
  const coverage = Array.from({ length: rows }, () => Array(columns).fill(0));
  let outOfBoard = 0;
  boxes.forEach((box) => {
    if (!isInsideBoard(box, rows, columns)) {
      outOfBoard += 1;
      return;
    }
    for (let r = box.row; r < box.row + box.height; r += 1) {
      for (let c = box.col; c < box.col + box.width; c += 1) coverage[r][c] += 1;
    }
  });
  const flat = coverage.flat();
  return {
    outOfBoard,
    uncoveredCells: flat.filter((n) => n === 0).length,
    overlappingCells: flat.filter((n) => n > 1).length,
  };
}

function isValidPartition(rows, columns, boxes) {
  const { outOfBoard, uncoveredCells, overlappingCells } = analyzePartition(rows, columns, boxes);
  return outOfBoard === 0 && uncoveredCells === 0 && overlappingCells === 0;
}

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

function getProgress(game) {
  const total = game.rectangles.length;
  const locked = game.rectangles.filter((r) => r.locked).length;
  return { locked, total, percent: total === 0 ? 0 : Math.round((locked / total) * 100) };
}

/**
 * Solved ⇔ every rectangle is locked, every rectangle sits on its solution slot,
 * nothing overlaps, the whole board is covered, and each rectangle holds exactly
 * one clue matching its area.
 */
function checkSolved(game) {
  const { rows, columns, rectangles, clues } = game;
  if (rectangles.length === 0) return { solved: false, reason: 'The puzzle has not been generated.' };

  const unlocked = rectangles.filter((r) => !r.locked || !r.currentPosition);
  if (unlocked.length > 0) {
    return { solved: false, reason: `${unlocked.length} rectangle(s) still to place.` };
  }
  if (!rectangles.every((r) => isCorrectSolutionPosition(r, toBox(r)))) {
    return { solved: false, reason: 'Some rectangles are not in their correct position.' };
  }
  const boxes = rectangles.map((r) => toBox(r));
  if (!isValidPartition(rows, columns, boxes)) {
    return { solved: false, reason: 'Rectangles overlap or leave cells uncovered.' };
  }
  if (!cluesMatchBoxes(boxes, clues)) {
    return { solved: false, reason: 'Every rectangle must contain exactly one matching number.' };
  }
  return { solved: true, reason: null };
}

module.exports = { analyzePartition, isValidPartition, cluesMatchBoxes, getProgress, checkSolved };

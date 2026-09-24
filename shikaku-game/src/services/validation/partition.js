'use strict';

const { isInsideBoard } = require('../rectangle');

/** Counts boxes off the board, and cells left uncovered or covered more than once. */
function analyzePartition(rows, columns, boxes) {
  const coverage = new Uint8Array(rows * columns);
  let outOfBoard = 0;
  let overlappingCells = 0;
  boxes.forEach((box) => {
    if (!isInsideBoard(box, rows, columns)) {
      outOfBoard += 1;
      return;
    }
    for (let r = box.row; r < box.row + box.height; r += 1) {
      for (let c = box.col; c < box.col + box.width; c += 1) {
        const cell = r * columns + c;
        if (coverage[cell] === 1) overlappingCells += 1; // count each cell once, on its second cover
        if (coverage[cell] < 2) coverage[cell] += 1;
      }
    }
  });
  const uncoveredCells = coverage.reduce((sum, n) => sum + (n === 0 ? 1 : 0), 0);
  return { outOfBoard, uncoveredCells, overlappingCells };
}

function isValidPartition(rows, columns, boxes) {
  const { outOfBoard, uncoveredCells, overlappingCells } = analyzePartition(rows, columns, boxes);
  return outOfBoard === 0 && uncoveredCells === 0 && overlappingCells === 0;
}

module.exports = { analyzePartition, isValidPartition };

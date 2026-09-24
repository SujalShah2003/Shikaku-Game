'use strict';

const { pickWeighted } = require('../../utils/random');
const { createGrid, fitsAt, markCovered } = require('./grid');
const { getRectangleLimits, eachSize } = require('./limits');

/**
 * Builds a guaranteed-valid partition of the board into rectangles.
 *
 * Cells are scanned in row-major order. The first uncovered cell is always the
 * top-left corner of a new rectangle (everything above and to its left is
 * already covered), so we choose a random size that fits entirely in uncovered
 * cells from there. Because every cell is claimed exactly once, the result is
 * non-overlapping and covers the whole board by construction.
 * Returns null if the limits make a cell impossible to cover (e.g. min size > 1).
 */
function generatePartition(rows, columns, { areaWeights = {}, limits = getRectangleLimits(), rng = Math.random } = {}) {
  const covered = createGrid(rows, columns, false);
  const sizes = eachSize(limits);
  const rectangles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (covered[row][col]) continue;

      const candidates = sizes.filter(({ width, height }) => fitsAt(covered, row, col, width, height));
      if (candidates.length === 0) return null;

      const { width, height } = pickWeighted(candidates, (c) => areaWeights[c.width * c.height] ?? 1, rng);
      const rectangle = { row, col, width, height };
      markCovered(covered, rectangle);
      rectangles.push(rectangle);
    }
  }
  return rectangles;
}

function singleCellRatio(partition) {
  return partition.filter((r) => r.width * r.height === 1).length / partition.length;
}

module.exports = { generatePartition, singleCellRatio };

'use strict';

function createGrid(rows, columns, value) {
  return Array.from({ length: rows }, () => Array(columns).fill(value));
}

function fitsAt(covered, row, col, width, height) {
  if (row + height > covered.length || col + width > covered[0].length) return false;
  for (let r = row; r < row + height; r += 1) {
    for (let c = col; c < col + width; c += 1) {
      if (covered[r][c]) return false;
    }
  }
  return true;
}

function markCovered(covered, { row, col, width, height }) {
  for (let r = row; r < row + height; r += 1) {
    for (let c = col; c < col + width; c += 1) covered[r][c] = true;
  }
}

module.exports = { createGrid, fitsAt, markCovered };

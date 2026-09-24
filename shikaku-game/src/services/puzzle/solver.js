'use strict';

const { createGrid } = require('./grid');
const { getRectangleLimits, eachSize } = require('./limits');

/** Flat cell indexes of the box, or null if it covers a clue other than `clueIndex`. */
function cellsOwnedBy(clueGrid, clueIndex, top, left, width, height, columns) {
  const cells = [];
  for (let r = top; r < top + height; r += 1) {
    for (let c = left; c < left + width; c += 1) {
      if (clueGrid[r][c] !== -1 && clueGrid[r][c] !== clueIndex) return null;
      cells.push(r * columns + c);
    }
  }
  return cells;
}

/** All rectangles that could satisfy `clue`: right area, within limits, inside board, no other clue. */
function candidatePlacementsForClue(clue, clueIndex, clueGrid, rows, columns, limits) {
  const placements = [];
  eachSize(limits, (width, height) => width * height === clue.value).forEach(({ width, height }) => {
    const firstTop = Math.max(0, clue.row - height + 1);
    const lastTop = Math.min(clue.row, rows - height);
    const firstLeft = Math.max(0, clue.col - width + 1);
    const lastLeft = Math.min(clue.col, columns - width);
    for (let top = firstTop; top <= lastTop; top += 1) {
      for (let left = firstLeft; left <= lastLeft; left += 1) {
        const cells = cellsOwnedBy(clueGrid, clueIndex, top, left, width, height, columns);
        if (cells) placements.push({ clueIndex, row: top, col: left, width, height, cells });
      }
    }
  });
  return placements;
}

/**
 * Counts solutions of a Shikaku clue layout (classic rules: clue = area, any
 * rectangle shape within the configured limits), stopping at `maxCount`.
 * Backtracks on the first uncovered cell, trying every placement that covers it.
 * Returns { count, exhausted } — `exhausted` means the node budget ran out.
 */
function countSolutions(rows, columns, clues, { maxCount = 2, nodeBudget = Infinity, limits = getRectangleLimits() } = {}) {
  const totalArea = clues.reduce((sum, clue) => sum + clue.value, 0);
  if (totalArea !== rows * columns) return { count: 0, exhausted: false };

  const clueGrid = createGrid(rows, columns, -1);
  clues.forEach((clue, index) => {
    clueGrid[clue.row][clue.col] = index;
  });

  const byCell = Array.from({ length: rows * columns }, () => []);
  clues.forEach((clue, index) => {
    candidatePlacementsForClue(clue, index, clueGrid, rows, columns, limits).forEach((placement) => {
      placement.cells.forEach((cell) => byCell[cell].push(placement));
    });
  });

  const occupied = new Uint8Array(rows * columns);
  const clueUsed = new Uint8Array(clues.length);
  const setCells = (cells, value) => {
    for (let i = 0; i < cells.length; i += 1) occupied[cells[i]] = value;
  };
  let count = 0;
  let nodes = 0;
  let exhausted = false;
  const done = () => count >= maxCount || exhausted;

  const search = (fromCell) => {
    if (done()) return;
    nodes += 1;
    if (nodes > nodeBudget) {
      exhausted = true;
      return;
    }
    let cell = fromCell;
    while (cell < occupied.length && occupied[cell]) cell += 1;
    if (cell === occupied.length) {
      count += 1;
      return;
    }
    for (const placement of byCell[cell]) {
      if (clueUsed[placement.clueIndex]) continue;
      if (placement.cells.some((c) => occupied[c])) continue;
      clueUsed[placement.clueIndex] = 1;
      setCells(placement.cells, 1);
      search(cell + 1);
      setCells(placement.cells, 0);
      clueUsed[placement.clueIndex] = 0;
      if (done()) return;
    }
  };

  search(0);
  return { count, exhausted };
}

function isUniquelySolvable(rows, columns, clues, options = {}) {
  const { count, exhausted } = countSolutions(rows, columns, clues, { ...options, maxCount: 2 });
  return count === 1 && !exhausted;
}

module.exports = { candidatePlacementsForClue, countSolutions, isUniquelySolvable };

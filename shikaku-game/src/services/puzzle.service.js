'use strict';

const { GAME_CONFIG } = require('../config/game.config');
const { pickWeighted, shuffle, generateId } = require('../utils/random');
const logger = require('../utils/logger');

const CLUE_LAYOUTS_PER_PARTITION = 3;

function getRectangleLimits(config = GAME_CONFIG) {
  return {
    minWidth: config.minRectangleWidth,
    maxWidth: config.maxRectangleWidth,
    minHeight: config.minRectangleHeight,
    maxHeight: config.maxRectangleHeight,
  };
}

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
  const rectangles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (covered[row][col]) continue;

      const candidates = [];
      for (let height = limits.minHeight; height <= limits.maxHeight; height += 1) {
        for (let width = limits.minWidth; width <= limits.maxWidth; width += 1) {
          if (fitsAt(covered, row, col, width, height)) candidates.push({ width, height });
        }
      }
      if (candidates.length === 0) return null;

      const { width, height } = pickWeighted(candidates, (c) => areaWeights[c.width * c.height] ?? 1, rng);
      const rectangle = { row, col, width, height };
      markCovered(covered, rectangle);
      rectangles.push(rectangle);
    }
  }
  return rectangles;
}

/** Places one clue in a random cell of each rectangle; clue value = rectangle area. */
function placeClues(partition, rng = Math.random) {
  return partition.map((rect) => {
    const row = rect.row + Math.floor(rng() * rect.height);
    const col = rect.col + Math.floor(rng() * rect.width);
    return { row, col, value: rect.width * rect.height };
  });
}

/** All rectangles that could satisfy `clue`: right area, within limits, inside board, no other clue. */
function candidatePlacementsForClue(clue, clueIndex, clueGrid, rows, columns, limits) {
  const placements = [];
  for (let height = limits.minHeight; height <= limits.maxHeight; height += 1) {
    for (let width = limits.minWidth; width <= limits.maxWidth; width += 1) {
      if (width * height !== clue.value) continue;
      for (let top = clue.row - height + 1; top <= clue.row; top += 1) {
        for (let left = clue.col - width + 1; left <= clue.col; left += 1) {
          if (top < 0 || left < 0 || top + height > rows || left + width > columns) continue;
          const cells = [];
          let clean = true;
          for (let r = top; r < top + height && clean; r += 1) {
            for (let c = left; c < left + width; c += 1) {
              if (clueGrid[r][c] !== -1 && clueGrid[r][c] !== clueIndex) {
                clean = false;
                break;
              }
              cells.push(r * columns + c);
            }
          }
          if (clean) placements.push({ clueIndex, row: top, col: left, width, height, cells });
        }
      }
    }
  }
  return placements;
}

/**
 * Counts solutions of a Shikaku clue layout (classic rules: clue = area, any
 * rectangle shape within the configured limits), stopping at `maxCount`.
 * Backtracks on the first uncovered cell, trying every placement that covers it.
 * Returns { count, exhausted } — `exhausted` means the node budget ran out.
 */
function countSolutions(rows, columns, clues, { maxCount = 2, nodeBudget = Infinity, limits = getRectangleLimits() } = {}) {
  const clueGrid = createGrid(rows, columns, -1);
  clues.forEach((clue, index) => {
    clueGrid[clue.row][clue.col] = index;
  });

  const totalArea = clues.reduce((sum, clue) => sum + clue.value, 0);
  if (totalArea !== rows * columns) return { count: 0, exhausted: false };

  const byCell = Array.from({ length: rows * columns }, () => []);
  clues.forEach((clue, index) => {
    candidatePlacementsForClue(clue, index, clueGrid, rows, columns, limits).forEach((placement) => {
      placement.cells.forEach((cell) => byCell[cell].push(placement));
    });
  });

  const occupied = new Uint8Array(rows * columns);
  const clueUsed = new Uint8Array(clues.length);
  let count = 0;
  let nodes = 0;
  let exhausted = false;

  const search = (fromCell) => {
    if (count >= maxCount || exhausted) return;
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
      placement.cells.forEach((c) => { occupied[c] = 1; });
      search(cell + 1);
      placement.cells.forEach((c) => { occupied[c] = 0; });
      clueUsed[placement.clueIndex] = 0;
      if (count >= maxCount || exhausted) return;
    }
  };

  search(0);
  return { count, exhausted };
}

function isUniquelySolvable(rows, columns, clues, options = {}) {
  const { count, exhausted } = countSolutions(rows, columns, clues, { ...options, maxCount: 2 });
  return count === 1 && !exhausted;
}

function singleCellRatio(partition) {
  return partition.filter((r) => r.width * r.height === 1).length / partition.length;
}

function buildPuzzle(partition, clueCells, uniqueSolution, attempts, rng) {
  const clues = clueCells.map((clue) => ({ id: generateId('clue'), ...clue }));
  const rectangles = partition.map((rect, index) => ({
    id: generateId('rect'),
    width: rect.width,
    height: rect.height,
    area: rect.width * rect.height,
    clueId: clues[index].id,
    solution: { row: rect.row, col: rect.col, width: rect.width, height: rect.height },
  }));
  // Shuffle so tray order reveals nothing about the solution's layout.
  return { clues, rectangles: shuffle(rectangles, rng), uniqueSolution, attempts };
}

/**
 * Generates a Shikaku puzzle: a valid partition, one clue per rectangle and the
 * stored solution. When the difficulty requires it, keeps generating until the
 * clue layout has exactly one solution; if the attempt budget runs out it falls
 * back to the last valid (still solvable) puzzle and flags `uniqueSolution: false`.
 */
function generatePuzzle(rows, columns, difficulty, { rng = Math.random, config = GAME_CONFIG } = {}) {
  const preset = config.difficulties[difficulty] || config.difficulties[config.defaultDifficulty];
  const limits = getRectangleLimits(config);
  const { maxAttempts, solverNodeBudget } = config.generator;
  let fallback = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const partition = generatePartition(rows, columns, { areaWeights: preset.areaWeights, limits, rng });
    if (!partition) continue;
    const tooTrivial = singleCellRatio(partition) > preset.singleCellRatio;
    if (tooTrivial && attempt < maxAttempts) continue;

    for (let layout = 0; layout < CLUE_LAYOUTS_PER_PARTITION; layout += 1) {
      const clueCells = placeClues(partition, rng);
      if (!preset.requireUniqueSolution) return buildPuzzle(partition, clueCells, false, attempt, rng);
      if (isUniquelySolvable(rows, columns, clueCells, { nodeBudget: solverNodeBudget, limits })) {
        return buildPuzzle(partition, clueCells, true, attempt, rng);
      }
      fallback = { partition, clueCells };
    }
  }

  if (!fallback) {
    throw new Error(`Unable to generate a ${rows}x${columns} puzzle with the configured rectangle limits.`);
  }
  logger.warn({ rows, columns, difficulty }, 'Unique-solution budget exhausted; using a solvable puzzle');
  return buildPuzzle(fallback.partition, fallback.clueCells, false, maxAttempts, rng);
}

module.exports = {
  generatePuzzle,
  generatePartition,
  placeClues,
  countSolutions,
  isUniquelySolvable,
  getRectangleLimits,
};

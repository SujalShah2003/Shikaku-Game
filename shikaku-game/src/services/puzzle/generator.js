'use strict';

const { GAME_CONFIG } = require('../../config/game.config');
const { shuffle, generateId } = require('../../utils/random');
const logger = require('../../utils/logger');
const { getRectangleLimits } = require('./limits');
const { generatePartition, singleCellRatio } = require('./partition');
const { placeClues } = require('./clues');
const { isUniquelySolvable } = require('./solver');

const CLUE_LAYOUTS_PER_PARTITION = 3;

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

module.exports = { generatePuzzle };

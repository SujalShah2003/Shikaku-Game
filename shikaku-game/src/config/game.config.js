'use strict';

/**
 * Centralised game configuration. Every board / rectangle limit in the
 * application is read from here — never hard-code these values elsewhere.
 */
const GAME_CONFIG = Object.freeze({
  minRows: 3,
  maxRows: 10,
  minColumns: 3,
  maxColumns: 10,
  minRectangleWidth: 1,
  maxRectangleWidth: 3,
  minRectangleHeight: 1,
  maxRectangleHeight: 3,
  defaultDifficulty: 'easy',

  /**
   * Difficulty presets. `singleCellRatio` caps how many 1×1 rectangles the
   * generator tolerates (they are trivial clues); `areaWeights` biases the
   * random choice of rectangle size; `requireUniqueSolution` makes the
   * generator keep trying until the clue layout has exactly one solution.
   */
  difficulties: Object.freeze({
    easy: Object.freeze({
      rows: 5,
      columns: 5,
      singleCellRatio: 0.2,
      areaWeights: Object.freeze({ 1: 1, 2: 4, 3: 4, 4: 3, 6: 2, 9: 1 }),
      requireUniqueSolution: true,
    }),
    medium: Object.freeze({
      rows: 7,
      columns: 7,
      singleCellRatio: 0.12,
      areaWeights: Object.freeze({ 1: 1, 2: 3, 3: 4, 4: 4, 6: 4, 9: 2 }),
      requireUniqueSolution: true,
    }),
    hard: Object.freeze({
      rows: 9,
      columns: 9,
      singleCellRatio: 0.08,
      areaWeights: Object.freeze({ 1: 1, 2: 2, 3: 3, 4: 4, 6: 5, 9: 4 }),
      requireUniqueSolution: true,
    }),
  }),

  generator: Object.freeze({
    // Attempts at finding a partition whose clues have a unique solution.
    maxAttempts: 150,
    // Search-node budget for a single uniqueness check (keeps generation fast).
    solverNodeBudget: 50000,
  }),
});

const DIFFICULTIES = Object.freeze(Object.keys(GAME_CONFIG.difficulties));

const GAME_STATUS = Object.freeze({
  CREATED: 'created',
  PLAYING: 'playing',
  COMPLETED: 'completed',
});

const RECTANGLE_STATUS = Object.freeze({
  AVAILABLE: 'available',
  SELECTED: 'selected',
  PLACED: 'placed',
  LOCKED: 'locked',
});

module.exports = { GAME_CONFIG, DIFFICULTIES, GAME_STATUS, RECTANGLE_STATUS };

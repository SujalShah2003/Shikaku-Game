'use strict';

/** Puzzle generation: random partition → clue layout → uniqueness check via the solver. */
const { generatePuzzle } = require('./generator');
const { generatePartition } = require('./partition');
const { placeClues } = require('./clues');
const { countSolutions, isUniquelySolvable } = require('./solver');
const { getRectangleLimits } = require('./limits');

module.exports = {
  generatePuzzle,
  generatePartition,
  placeClues,
  countSolutions,
  isUniquelySolvable,
  getRectangleLimits,
};

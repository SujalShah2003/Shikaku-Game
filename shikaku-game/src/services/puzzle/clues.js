'use strict';

/** Places one clue in a random cell of each rectangle; clue value = rectangle area. */
function placeClues(partition, rng = Math.random) {
  return partition.map((rect) => {
    const row = rect.row + Math.floor(rng() * rect.height);
    const col = rect.col + Math.floor(rng() * rect.width);
    return { row, col, value: rect.width * rect.height };
  });
}

module.exports = { placeClues };

'use strict';

function getProgress(game) {
  const total = game.rectangles.length;
  const locked = game.rectangles.reduce((sum, r) => sum + (r.locked ? 1 : 0), 0);
  return { locked, total, percent: total === 0 ? 0 : Math.round((locked / total) * 100) };
}

module.exports = { getProgress };

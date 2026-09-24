'use strict';

const { GAME_CONFIG } = require('../../config/game.config');

function getRectangleLimits(config = GAME_CONFIG) {
  return {
    minWidth: config.minRectangleWidth,
    maxWidth: config.maxRectangleWidth,
    minHeight: config.minRectangleHeight,
    maxHeight: config.maxRectangleHeight,
  };
}

/** Every { width, height } allowed by `limits`, optionally filtered by `keep`. */
function eachSize(limits, keep = () => true) {
  const sizes = [];
  for (let height = limits.minHeight; height <= limits.maxHeight; height += 1) {
    for (let width = limits.minWidth; width <= limits.maxWidth; width += 1) {
      if (keep(width, height)) sizes.push({ width, height });
    }
  }
  return sizes;
}

module.exports = { getRectangleLimits, eachSize };

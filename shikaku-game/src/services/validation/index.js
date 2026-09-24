'use strict';

/** Board-level checks, used to verify generated partitions and to decide whether a game is solved. */
module.exports = {
  ...require('./partition'),
  ...require('./progress'),
  ...require('./solved'),
};

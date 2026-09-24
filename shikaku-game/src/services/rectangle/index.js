'use strict';

/** Rectangle rules: box geometry, the status lifecycle, and placement validation. */
module.exports = {
  ...require('./geometry'),
  ...require('./lifecycle'),
  ...require('./placement'),
};

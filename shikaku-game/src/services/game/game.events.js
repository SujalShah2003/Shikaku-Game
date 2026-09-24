'use strict';

/** Server → client event names. The socket layer relays these to `game:{gameId}` rooms. */
const GAME_EVENTS = Object.freeze({
  STARTED: 'game:started',
  UPDATED: 'game:updated',
  RECTANGLE_SELECTED: 'rectangle:selected',
  RECTANGLE_MOVED: 'rectangle:moved',
  RECTANGLE_LOCKED: 'rectangle:locked',
  RESET: 'game:reset',
  WON: 'game:won',
  TIMER_UPDATED: 'timer:updated',
});

module.exports = { GAME_EVENTS };

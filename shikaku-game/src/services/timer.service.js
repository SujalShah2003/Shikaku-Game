'use strict';

/**
 * Timer state lives entirely in `startedAt` / `endedAt` on the game — no
 * server-side intervals. Pausing sets `endedAt`; resuming shifts `startedAt`
 * forward by the paused duration, so `endedAt - startedAt` is always the
 * active play time.
 */
const toMs = (date) => (date ? new Date(date).getTime() : null);

function isTimerRunning(game) {
  return Boolean(game.startedAt) && !game.endedAt;
}

function getElapsedSeconds(game, now = new Date()) {
  const startedAt = toMs(game.startedAt);
  if (startedAt === null) return 0;
  const end = toMs(game.endedAt) ?? toMs(now);
  return Math.max(0, Math.floor((end - startedAt) / 1000));
}

function startTimer(game, now = new Date()) {
  if (!game.startedAt) {
    game.startedAt = new Date(now);
  } else if (game.endedAt) {
    const pausedMs = toMs(now) - toMs(game.endedAt);
    game.startedAt = new Date(toMs(game.startedAt) + pausedMs);
  }
  game.endedAt = null;
  game.elapsedSeconds = getElapsedSeconds(game, now);
  return game;
}

function stopTimer(game, now = new Date()) {
  if (isTimerRunning(game)) game.endedAt = new Date(now);
  game.elapsedSeconds = getElapsedSeconds(game, now);
  return game;
}

function resetTimer(game) {
  game.startedAt = null;
  game.endedAt = null;
  game.elapsedSeconds = 0;
  return game;
}

function getTimerState(game, now = new Date()) {
  return {
    running: isTimerRunning(game),
    elapsedSeconds: getElapsedSeconds(game, now),
    startedAt: game.startedAt || null,
    endedAt: game.endedAt || null,
    serverTime: new Date(now).toISOString(),
  };
}

module.exports = { isTimerRunning, getElapsedSeconds, startTimer, stopTimer, resetTimer, getTimerState };

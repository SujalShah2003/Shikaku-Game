'use strict';

const timer = require('../src/services/timer');

const at = (seconds) => new Date(Date.UTC(2026, 0, 1, 10, 0, seconds));

describe('timer.service', () => {
  test('not started → 0 seconds, not running', () => {
    const game = { startedAt: null, endedAt: null };
    expect(timer.getElapsedSeconds(game, at(30))).toBe(0);
    expect(timer.isTimerRunning(game)).toBe(false);
  });

  test('elapsed is derived from startedAt/endedAt, not intervals', () => {
    const game = {};
    timer.startTimer(game, at(0));
    expect(timer.getElapsedSeconds(game, at(42))).toBe(42);
    timer.stopTimer(game, at(50));
    expect(game.elapsedSeconds).toBe(50);
    expect(timer.getElapsedSeconds(game, at(59))).toBe(50); // frozen once stopped
  });

  test('resume excludes paused time', () => {
    const game = {};
    timer.startTimer(game, at(0));
    timer.stopTimer(game, at(10));
    timer.startTimer(game, at(40)); // paused for 30s
    expect(timer.isTimerRunning(game)).toBe(true);
    expect(timer.getElapsedSeconds(game, at(45))).toBe(15);
  });

  test('reset clears everything', () => {
    const game = {};
    timer.startTimer(game, at(0));
    timer.resetTimer(game);
    expect(game).toEqual({ startedAt: null, endedAt: null, elapsedSeconds: 0 });
  });
});

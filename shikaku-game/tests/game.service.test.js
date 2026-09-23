'use strict';

const { createTestService, solveGame } = require('./helpers/fixtures');
const { GAME_EVENTS } = require('../src/services/game.service');

const expectAppError = (code) => expect.objectContaining({ code });

function findWrongPosition(raw, rect) {
  // Any on-board top-left position that is not a valid solution slot for this shape.
  for (let row = 0; row < raw.rows; row += 1) {
    for (let col = 0; col < raw.columns; col += 1) {
      const matchesSomeSlot = raw.rectangles.some(
        (r) => r.width === rect.width && r.height === rect.height && r.solution.row === row && r.solution.col === col,
      );
      if (!matchesSomeSlot) return { row, col };
    }
  }
  throw new Error('no wrong position found');
}

async function startedGame(options) {
  const ctx = createTestService(options);
  const game = await ctx.service.createGame({ difficulty: 'easy' });
  await ctx.service.startGame(game.gameId);
  return { ...ctx, gameId: game.gameId };
}

describe('game.service — creation', () => {
  test('creates a game with a generated puzzle', async () => {
    const { service } = createTestService();
    const game = await service.createGame({ difficulty: 'medium' });
    expect(game).toMatchObject({ rows: 7, columns: 7, difficulty: 'medium', status: 'created', moves: 0 });
    expect(game.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(game.clues.length).toBe(game.rectangles.length);
    expect(game.rectangles.reduce((sum, r) => sum + r.area, 0)).toBe(49);
  });

  test('custom board size within limits', async () => {
    const { service } = createTestService();
    const game = await service.createGame({ difficulty: 'hard', rows: 4, columns: 6 });
    expect(game).toMatchObject({ rows: 4, columns: 6, difficulty: 'hard' });
  });

  test('rejects invalid sizes and difficulties', async () => {
    const { service } = createTestService();
    await expect(service.createGame({ rows: 2, columns: 5 })).rejects.toEqual(expectAppError('INVALID_BOARD_SIZE'));
    await expect(service.createGame({ rows: 11 })).rejects.toEqual(expectAppError('INVALID_BOARD_SIZE'));
    await expect(service.createGame({ difficulty: 'insane' })).rejects.toEqual(expectAppError('INVALID_DIFFICULTY'));
  });

  test('public game never exposes solution data', async () => {
    const { service } = createTestService();
    const game = await service.createGame({});
    const json = JSON.stringify(await service.getGame(game.gameId));
    expect(json).not.toMatch(/solution|clueId/);
    game.rectangles.forEach((r) => expect(r.currentPosition).toBeNull());
  });

  test('unknown game → GAME_NOT_FOUND', async () => {
    const { service } = createTestService();
    await expect(service.getGame('00000000-0000-4000-8000-000000000000')).rejects.toEqual(expectAppError('GAME_NOT_FOUND'));
  });

  test('generate regenerates only before the game starts', async () => {
    const { service } = createTestService();
    const game = await service.createGame({});
    const regenerated = await service.generatePuzzle(game.gameId);
    expect(regenerated.clues.map((c) => c.id)).not.toEqual(game.clues.map((c) => c.id));
    await service.startGame(game.gameId);
    await expect(service.generatePuzzle(game.gameId)).rejects.toEqual(expectAppError('INVALID_GAME_STATE'));
  });
});

describe('game.service — play', () => {
  test('moves require a started game', async () => {
    const { service, repository } = createTestService();
    const game = await service.createGame({});
    const rect = repository.raw(game.gameId).rectangles[0];
    await expect(service.selectRectangle(game.gameId, rect.id)).rejects.toEqual(expectAppError('INVALID_GAME_STATE'));
  });

  test('select marks exactly one rectangle as selected', async () => {
    const { service, gameId } = await startedGame();
    const { rectangles } = await service.getGame(gameId);
    await service.selectRectangle(gameId, rectangles[0].id);
    const game = await service.selectRectangle(gameId, rectangles[1].id);
    expect(game.selectedRectangle).toBe(rectangles[1].id);
    expect(game.rectangles.filter((r) => r.selected).map((r) => r.id)).toEqual([rectangles[1].id]);
  });

  test('unknown rectangle → RECTANGLE_NOT_FOUND', async () => {
    const { service, gameId } = await startedGame();
    await expect(service.selectRectangle(gameId, 'rect-0000000000')).rejects.toEqual(expectAppError('RECTANGLE_NOT_FOUND'));
  });

  test('valid placement locks the rectangle and counts a move', async () => {
    const { service, repository, gameId } = await startedGame();
    const rect = repository.raw(gameId).rectangles[0];
    const result = await service.placeRectangle(gameId, { rectangleId: rect.id, row: rect.solution.row, col: rect.solution.col });
    expect(result.placement.accepted).toBe(true);
    const placed = result.game.rectangles.find((r) => r.id === rect.id);
    expect(placed).toMatchObject({ status: 'locked', locked: true, currentPosition: { row: rect.solution.row, col: rect.solution.col } });
    expect(result.game.moves).toBe(1);
  });

  test('invalid placement is rejected, persisted as a move, and the rectangle returns to the tray', async () => {
    const { service, repository, gameId } = await startedGame();
    const raw = repository.raw(gameId);
    const rect = raw.rectangles[0];
    const wrong = findWrongPosition(raw, rect);
    const result = await service.placeRectangle(gameId, { rectangleId: rect.id, ...wrong });
    expect(result.placement.accepted).toBe(false);
    expect(['INVALID_PLACEMENT', 'RECTANGLE_OUT_OF_BOARD', 'RECTANGLE_OVERLAP']).toContain(result.placement.code);
    expect(result.game.moves).toBe(1);
    expect(result.game.rectangles.find((r) => r.id === rect.id)).toMatchObject({ status: 'available', locked: false, currentPosition: null });
  });

  test('locked rectangle cannot be moved or selected', async () => {
    const { service, repository, gameId } = await startedGame();
    const rect = repository.raw(gameId).rectangles[0];
    const move = { rectangleId: rect.id, row: rect.solution.row, col: rect.solution.col };
    await service.placeRectangle(gameId, move);
    await expect(service.placeRectangle(gameId, move)).rejects.toEqual(expectAppError('RECTANGLE_ALREADY_LOCKED'));
    await expect(service.selectRectangle(gameId, rect.id)).rejects.toEqual(expectAppError('RECTANGLE_ALREADY_LOCKED'));
  });

  test('check reports unsolved progress', async () => {
    const { service, gameId } = await startedGame();
    const result = await service.checkWin(gameId);
    expect(result.solved).toBe(false);
    expect(result.game.status).toBe('playing');
  });
});

describe('game.service — completion', () => {
  test('placing every rectangle completes the game and emits game:won', async () => {
    const { service, repository, events, clock, gameId } = await startedGame();
    const won = jest.fn();
    events.on(GAME_EVENTS.WON, won);
    clock.advance(82);
    const last = await solveGame(service, repository, gameId);
    expect(last.solved).toBe(true);
    expect(last.game).toMatchObject({ status: 'completed', elapsedSeconds: 82 });
    expect(last.game.progress).toMatchObject({ locked: last.game.rectangles.length, percent: 100 });
    expect(won).toHaveBeenCalledTimes(1);
    expect(won.mock.calls[0][0]).toMatchObject({ gameId, elapsedSeconds: 82 });

    const check = await service.checkWin(gameId);
    expect(check).toMatchObject({ solved: true, message: 'Congratulations! Puzzle solved.', elapsedSeconds: 82 });
  });

  test('completed game rejects further moves', async () => {
    const { service, repository, gameId } = await startedGame();
    await solveGame(service, repository, gameId);
    const rect = repository.raw(gameId).rectangles[0];
    await expect(service.placeRectangle(gameId, { rectangleId: rect.id, row: 0, col: 0 })).rejects.toEqual(expectAppError('GAME_ALREADY_COMPLETED'));
    await expect(service.startGame(gameId)).rejects.toEqual(expectAppError('GAME_ALREADY_COMPLETED'));
  });
});

describe('game.service — timer', () => {
  test('start, stop, resume use server timestamps', async () => {
    const { service, clock, gameId } = await startedGame();
    clock.advance(30);
    const stopped = await service.stopTimer(gameId);
    expect(stopped.elapsedSeconds).toBe(30);
    expect(stopped.game.timer.running).toBe(false);

    clock.advance(100); // paused time does not count
    const paused = await service.getGame(gameId);
    expect(paused.elapsedSeconds).toBe(30);

    await service.startGame(gameId);
    clock.advance(5);
    expect((await service.getGame(gameId)).elapsedSeconds).toBe(35);
  });

  test('paused game rejects moves', async () => {
    const { service, gameId } = await startedGame();
    await service.stopTimer(gameId);
    const { rectangles } = await service.getGame(gameId);
    await expect(service.selectRectangle(gameId, rectangles[0].id)).rejects.toEqual(expectAppError('INVALID_GAME_STATE'));
  });

  test('stopping before start is an invalid state', async () => {
    const { service } = createTestService();
    const game = await service.createGame({});
    await expect(service.stopTimer(game.gameId)).rejects.toEqual(expectAppError('INVALID_GAME_STATE'));
  });
});

describe('game.service — reset', () => {
  test('reset generates a brand-new puzzle and clears progress', async () => {
    const { service, repository, clock, gameId } = await startedGame();
    const before = repository.raw(gameId);
    const rect = before.rectangles[0];
    await service.placeRectangle(gameId, { rectangleId: rect.id, row: rect.solution.row, col: rect.solution.col });
    clock.advance(20);

    const reset = await service.resetGame(gameId);
    const oldIds = new Set(before.rectangles.map((r) => r.id));
    expect(reset).toMatchObject({ status: 'created', moves: 0, elapsedSeconds: 0, selectedRectangle: null, startedAt: null });
    expect(reset.rectangles.every((r) => !oldIds.has(r.id) && !r.locked && r.status === 'available')).toBe(true);
    expect(reset.clues.map((c) => c.id)).not.toEqual(before.clues.map((c) => c.id));
  });

  test('reset can switch difficulty', async () => {
    const { service, gameId } = await startedGame();
    const reset = await service.resetGame(gameId, { difficulty: 'hard' });
    expect(reset).toMatchObject({ difficulty: 'hard', rows: 9, columns: 9 });
  });

  test('reset works after completion', async () => {
    const { service, repository, gameId } = await startedGame();
    await solveGame(service, repository, gameId);
    const reset = await service.resetGame(gameId);
    expect(reset.status).toBe('created');
  });
});

describe('game.service — concurrency', () => {
  test('concurrent placements are all applied (optimistic retry)', async () => {
    const { service, repository, gameId } = await startedGame();
    const rects = repository.raw(gameId).rectangles.slice(0, 4);
    const results = await Promise.all(
      rects.map((r) => service.placeRectangle(gameId, { rectangleId: r.id, row: r.solution.row, col: r.solution.col })),
    );
    expect(results.every((r) => r.placement.accepted)).toBe(true);
    const game = await service.getGame(gameId);
    expect(game.progress.locked).toBe(4);
    expect(game.moves).toBe(4);
  });
});

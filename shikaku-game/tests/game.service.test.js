'use strict';

const { createTestService, solveGame, solutionBox } = require('./helpers/fixtures');
const { GAME_EVENTS } = require('../src/services/game.service');

const expectAppError = (code) => expect.objectContaining({ code });

/** A 1×1 box on a cell with no number — always an invalid rectangle. */
function findWrongBox(raw) {
  for (let row = 0; row < raw.rows; row += 1) {
    for (let col = 0; col < raw.columns; col += 1) {
      if (!raw.clues.some((c) => c.row === row && c.col === col)) return { row, col, width: 1, height: 1 };
    }
  }
  throw new Error('board has a clue in every cell');
}

async function startedGame(options) {
  const ctx = createTestService(options);
  const game = await ctx.service.createGame({ difficulty: 'easy' });
  await ctx.service.startGame(game.gameId);
  return { ...ctx, gameId: game.gameId };
}

describe('game.service — creation', () => {
  test('creates a game with a generated puzzle', async () => {
    const { service, repository } = createTestService();
    const game = await service.createGame({ difficulty: 'medium' });
    expect(game).toMatchObject({ rows: 7, columns: 7, difficulty: 'medium', status: 'created', moves: 0 });
    expect(game.gameId).toMatch(/^[0-9a-f-]{36}$/);
    const raw = repository.raw(game.gameId);
    expect(game.clues.length).toBe(raw.rectangles.length);
    expect(raw.rectangles.reduce((sum, r) => sum + r.area, 0)).toBe(49);
    expect(game.progress).toMatchObject({ locked: 0, total: raw.rectangles.length });
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

  test('public game never exposes solution data or unlocked rectangles', async () => {
    const { service } = createTestService();
    const game = await service.createGame({});
    const publicGame = await service.getGame(game.gameId);
    expect(JSON.stringify(publicGame)).not.toMatch(/solution|clueId/);
    expect(publicGame.rectangles).toEqual([]);
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
    const { service } = createTestService();
    const game = await service.createGame({});
    await expect(service.selectRectangle(game.gameId, { row: 0, col: 0 })).rejects.toEqual(expectAppError('INVALID_GAME_STATE'));
    await expect(service.placeRectangle(game.gameId, { row: 0, col: 0, width: 1, height: 1 })).rejects.toEqual(expectAppError('INVALID_GAME_STATE'));
  });

  test('select records the anchor cell and marks the hidden rectangle selected', async () => {
    const { service, repository, gameId } = await startedGame();
    await service.selectRectangle(gameId, { row: 0, col: 0 });
    const game = await service.selectRectangle(gameId, { row: 1, col: 1 });
    expect(game.selectedRectangle).toEqual({ row: 1, col: 1 });
    const selected = repository.raw(gameId).rectangles.filter((r) => r.status === 'selected');
    expect(selected).toHaveLength(1);
    expect(selected[0].solution.row <= 1 && selected[0].solution.row + selected[0].solution.height > 1).toBe(true);
  });

  test('valid placement locks the rectangle, counts a move and clears the selection', async () => {
    const { service, repository, gameId } = await startedGame();
    const rect = repository.raw(gameId).rectangles[0];
    await service.selectRectangle(gameId, { row: rect.solution.row, col: rect.solution.col });
    const result = await service.placeRectangle(gameId, solutionBox(rect));
    expect(result.placement).toMatchObject({ accepted: true, rectangleId: rect.id });
    expect(result.game.rectangles).toEqual([
      expect.objectContaining({ id: rect.id, locked: true, width: rect.width, height: rect.height, currentPosition: { row: rect.solution.row, col: rect.solution.col } }),
    ]);
    expect(result.game.moves).toBe(1);
    expect(result.game.selectedRectangle).toBeNull();
  });

  test('invalid placement is rejected and persisted as a move', async () => {
    const { service, repository, gameId } = await startedGame();
    const wrong = findWrongBox(repository.raw(gameId));
    const result = await service.placeRectangle(gameId, wrong);
    expect(result.placement.accepted).toBe(false);
    expect(result.placement.code).toBe('INVALID_PLACEMENT');
    expect(result.game.moves).toBe(1);
    expect(result.game.progress.locked).toBe(0);
  });

  test('locked rectangle cannot be drawn over or selected again', async () => {
    const { service, repository, gameId } = await startedGame();
    const rect = repository.raw(gameId).rectangles[0];
    await service.placeRectangle(gameId, solutionBox(rect));
    const again = await service.placeRectangle(gameId, solutionBox(rect));
    expect(again.placement).toMatchObject({ accepted: false, code: 'RECTANGLE_OVERLAP' });
    await expect(service.selectRectangle(gameId, { row: rect.solution.row, col: rect.solution.col })).rejects.toEqual(
      expectAppError('RECTANGLE_ALREADY_LOCKED'),
    );
  });

  test('check reports unsolved progress', async () => {
    const { service, gameId } = await startedGame();
    const result = await service.checkWin(gameId);
    expect(result.solved).toBe(false);
    expect(result.game.status).toBe('playing');
  });
});

describe('game.service — completion', () => {
  test('drawing every rectangle completes the game and emits game:won', async () => {
    const { service, repository, events, clock, gameId } = await startedGame();
    const won = jest.fn();
    events.on(GAME_EVENTS.WON, won);
    clock.advance(82);
    const last = await solveGame(service, repository, gameId);
    const total = repository.raw(gameId).rectangles.length;
    expect(last.solved).toBe(true);
    expect(last.game).toMatchObject({ status: 'completed', elapsedSeconds: 82 });
    expect(last.game.rectangles).toHaveLength(total);
    expect(last.game.progress).toMatchObject({ locked: total, percent: 100 });
    expect(won).toHaveBeenCalledTimes(1);
    expect(won.mock.calls[0][0]).toMatchObject({ gameId, elapsedSeconds: 82 });

    const check = await service.checkWin(gameId);
    expect(check).toMatchObject({ solved: true, message: 'Congratulations! Puzzle solved.', elapsedSeconds: 82 });
  });

  test('completed game rejects further moves', async () => {
    const { service, repository, gameId } = await startedGame();
    await solveGame(service, repository, gameId);
    await expect(service.placeRectangle(gameId, { row: 0, col: 0, width: 1, height: 1 })).rejects.toEqual(expectAppError('GAME_ALREADY_COMPLETED'));
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
    expect((await service.getGame(gameId)).elapsedSeconds).toBe(30);

    await service.startGame(gameId);
    clock.advance(5);
    expect((await service.getGame(gameId)).elapsedSeconds).toBe(35);
  });

  test('paused game rejects moves', async () => {
    const { service, gameId } = await startedGame();
    await service.stopTimer(gameId);
    await expect(service.selectRectangle(gameId, { row: 0, col: 0 })).rejects.toEqual(expectAppError('INVALID_GAME_STATE'));
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
    await service.placeRectangle(gameId, solutionBox(before.rectangles[0]));
    clock.advance(20);

    const reset = await service.resetGame(gameId);
    const after = repository.raw(gameId);
    const oldIds = new Set(before.rectangles.map((r) => r.id));
    expect(reset).toMatchObject({ status: 'created', moves: 0, elapsedSeconds: 0, selectedRectangle: null, startedAt: null, rectangles: [] });
    expect(after.rectangles.every((r) => !oldIds.has(r.id) && !r.locked && r.status === 'available')).toBe(true);
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
    const results = await Promise.all(rects.map((r) => service.placeRectangle(gameId, solutionBox(r))));
    expect(results.every((r) => r.placement.accepted)).toBe(true);
    const game = await service.getGame(gameId);
    expect(game.progress.locked).toBe(4);
    expect(game.moves).toBe(4);
  });
});

'use strict';

const http = require('node:http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../src/app');
const { registerGameSocket } = require('../src/socket/game.socket');
const { createTestService } = require('./helpers/fixtures');

const waitFor = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

describe('Socket.IO', () => {
  let ctx;
  let httpServer;
  let ioServer;
  let url;
  const clients = [];

  beforeAll(async () => {
    ctx = createTestService();
    httpServer = http.createServer(createApp({ gameService: ctx.service, healthCheck: () => 'connected' }));
    ioServer = new Server(httpServer);
    registerGameSocket(ioServer, ctx.service);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    await new Promise((resolve) => ioServer.close(resolve));
  });

  async function client() {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    await waitFor(socket, 'connect');
    return socket;
  }

  test('two clients in the same room stay synchronised', async () => {
    const game = await ctx.service.createGame({ difficulty: 'easy' });
    const { gameId } = game;
    const a = await client();
    const b = await client();

    const joinedA = await a.emitWithAck('game:join', { gameId });
    const joinedB = await b.emitWithAck('game:join', { gameId });
    expect(joinedA.success && joinedB.success).toBe(true);

    const startedOnB = waitFor(b, 'game:started');
    await a.emitWithAck('game:start', { gameId });
    expect((await startedOnB).game.status).toBe('playing');

    const rect = ctx.repository.raw(gameId).rectangles[0];
    const selectedOnB = waitFor(b, 'rectangle:selected');
    await a.emitWithAck('rectangle:select', { gameId, rectangleId: rect.id });
    expect((await selectedOnB).rectangleId).toBe(rect.id);

    const movedOnB = waitFor(b, 'rectangle:moved');
    const lockedOnB = waitFor(b, 'rectangle:locked');
    const updatedOnB = waitFor(b, 'game:updated');
    const ack = await a.emitWithAck('rectangle:place', { gameId, rectangleId: rect.id, row: rect.solution.row, col: rect.solution.col });
    expect(ack.success).toBe(true);
    expect((await movedOnB).accepted).toBe(true);
    expect((await lockedOnB).rectangleId).toBe(rect.id);
    const updated = await updatedOnB;
    expect(updated.game.rectangles.find((r) => r.id === rect.id).locked).toBe(true);
    expect(JSON.stringify(updated)).not.toMatch(/solution|clueId/);
  });

  test('REST actions are broadcast to socket rooms too (shared service)', async () => {
    const game = await ctx.service.createGame({});
    const socket = await client();
    await socket.emitWithAck('game:join', { gameId: game.gameId });
    const reset = waitFor(socket, 'game:reset');
    await ctx.service.resetGame(game.gameId);
    const payload = await reset;
    expect(payload.game.gameId).toBe(game.gameId);
  });

  test('invalid payloads are answered with game:error', async () => {
    const socket = await client();
    const errorEvent = waitFor(socket, 'game:error');
    const ack = await socket.emitWithAck('game:join', { gameId: 'nope' });
    expect(ack).toMatchObject({ success: false, error: { code: 'INVALID_GAME_ID' } });
    expect((await errorEvent).code).toBe('INVALID_GAME_ID');
  });

  test('rejected placement acks with an error and broadcasts rectangle:moved', async () => {
    const game = await ctx.service.createGame({});
    const { gameId } = game;
    const socket = await client();
    await socket.emitWithAck('game:join', { gameId });
    await socket.emitWithAck('game:start', { gameId });
    const raw = ctx.repository.raw(gameId);
    const big = raw.rectangles.find((r) => r.width > 1) || raw.rectangles[0];
    const moved = waitFor(socket, 'rectangle:moved');
    const ack = await socket.emitWithAck('rectangle:place', { gameId, rectangleId: big.id, row: 0, col: raw.columns - 1 });
    if (big.width > 1) {
      expect(ack).toMatchObject({ success: false, error: { code: 'RECTANGLE_OUT_OF_BOARD' } });
      expect((await moved).accepted).toBe(false);
    }
  });

  test('winning broadcasts game:won to the room', async () => {
    const game = await ctx.service.createGame({ difficulty: 'easy' });
    const { gameId } = game;
    const socket = await client();
    await socket.emitWithAck('game:join', { gameId });
    await socket.emitWithAck('game:start', { gameId });
    const won = waitFor(socket, 'game:won');
    for (const rect of ctx.repository.raw(gameId).rectangles) {
      await socket.emitWithAck('rectangle:place', { gameId, rectangleId: rect.id, row: rect.solution.row, col: rect.solution.col });
    }
    const payload = await won;
    expect(payload.game.status).toBe('completed');
    expect(payload).toMatchObject({ gameId, elapsedSeconds: expect.any(Number) });
  });
});

'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { createTestService, solutionBox } = require('./helpers/fixtures');

function setup() {
  const ctx = createTestService();
  const app = createApp({ gameService: ctx.service, healthCheck: () => 'connected' });
  return { ...ctx, app };
}

async function createAndStart(app) {
  const created = await request(app).post('/api/games').send({ difficulty: 'easy' });
  await request(app).post(`/api/games/${created.body.data.gameId}/start`);
  return created.body.data.gameId;
}

describe('REST API', () => {
  test('POST /api/games creates a game', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/games').send({ rows: 5, columns: 5, difficulty: 'easy' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ rows: 5, columns: 5, difficulty: 'easy', status: 'created' });
  });

  test('validation errors use the standard error format', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/games').send({ rows: 50 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_BOARD_SIZE' } });

    const bad = await request(app).post('/api/games').send({ difficulty: 'nightmare' });
    expect(bad.body.error.code).toBe('INVALID_DIFFICULTY');

    const malformed = await request(app).post('/api/games').set('Content-Type', 'application/json').send('{"rows":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('GET with malformed / unknown IDs', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/games/not-a-uuid')).body.error.code).toBe('INVALID_GAME_ID');
    const missing = await request(app).get('/api/games/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('GAME_NOT_FOUND');
  });

  test('responses never include solution data', async () => {
    const { app } = setup();
    const created = await request(app).post('/api/games').send({});
    const fetched = await request(app).get(`/api/games/${created.body.data.gameId}`);
    expect(JSON.stringify(created.body)).not.toMatch(/solution|clueId/);
    expect(JSON.stringify(fetched.body)).not.toMatch(/solution|clueId/);
  });

  test('full flow: start → select → invalid place (422) → valid place → check → stop → reset', async () => {
    const { app, repository } = setup();
    const gameId = await createAndStart(app);
    const raw = repository.raw(gameId);
    const [rect] = raw.rectangles;
    const url = (suffix) => `/api/games/${gameId}${suffix}`;

    const select = await request(app).post(url('/rectangles/select')).send({ row: rect.solution.row, col: rect.solution.col });
    expect(select.body.data.selectedRectangle).toEqual({ row: rect.solution.row, col: rect.solution.col });

    const outOfBoard = await request(app).post(url('/rectangles/place')).send({ row: raw.rows - 1, col: raw.columns - 1, width: 2, height: 1 });
    expect(outOfBoard.status).toBe(422);
    expect(outOfBoard.body.error.code).toBe('RECTANGLE_OUT_OF_BOARD');
    expect(JSON.stringify(outOfBoard.body)).not.toMatch(/solution/);

    const place = await request(app).post(url('/rectangles/place')).send(solutionBox(rect));
    expect(place.status).toBe(200);
    expect(place.body.data.placement).toMatchObject({ accepted: true, rectangleId: rect.id });

    const again = await request(app).post(url('/rectangles/place')).send(solutionBox(rect));
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('RECTANGLE_OVERLAP');

    const lockedCell = await request(app).post(url('/rectangles/select')).send({ row: rect.solution.row, col: rect.solution.col });
    expect(lockedCell.status).toBe(409);
    expect(lockedCell.body.error.code).toBe('RECTANGLE_ALREADY_LOCKED');

    const check = await request(app).post(url('/check'));
    expect(check.body).toMatchObject({ success: true, solved: false });

    const stop = await request(app).post(url('/timer/stop'));
    expect(stop.body).toMatchObject({ success: true, elapsedSeconds: expect.any(Number) });

    const reset = await request(app).post(url('/reset')).send({});
    expect(reset.body.data).toMatchObject({ status: 'created', moves: 0 });
  });

  test('malformed coordinates are rejected by validation', async () => {
    const { app } = setup();
    const gameId = await createAndStart(app);
    const negative = await request(app).post(`/api/games/${gameId}/rectangles/place`).send({ row: -1, col: 0, width: 1, height: 1 });
    expect(negative.status).toBe(400);
    expect(negative.body.error.code).toBe('INVALID_POSITION');
    const zeroWidth = await request(app).post(`/api/games/${gameId}/rectangles/place`).send({ row: 0, col: 0, width: 0, height: 1 });
    expect(zeroWidth.body.error.code).toBe('INVALID_POSITION');
  });

  test('solving via REST returns solved from /check', async () => {
    const { app, repository } = setup();
    const gameId = await createAndStart(app);
    for (const rect of repository.raw(gameId).rectangles) {
      await request(app).post(`/api/games/${gameId}/rectangles/place`).send(solutionBox(rect));
    }
    const check = await request(app).post(`/api/games/${gameId}/check`);
    expect(check.body).toMatchObject({ success: true, solved: true, message: 'Congratulations! Puzzle solved.' });
    expect(check.body.data.status).toBe('completed');
  });

  test('health endpoint and page rendering', async () => {
    const { app } = setup();
    const health = await request(app).get('/health');
    expect(health.body).toMatchObject({ status: 'ok', database: 'connected' });

    const page = await request(app).get('/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Shikaku');
    expect(page.text).toContain('id="board"');

    expect((await request(app).get('/api/nope')).body.error.code).toBe('ROUTE_NOT_FOUND');
    expect((await request(app).get('/nope').set('Accept', 'text/html')).status).toBe(404);
  });

  test('health reports degraded when the database is down', async () => {
    const ctx = createTestService();
    const app = createApp({ gameService: ctx.service, healthCheck: () => 'disconnected' });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
  });
});

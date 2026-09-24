'use strict';

const { checkSolved, isValidPartition, analyzePartition, getProgress } = require('../src/services/validation');

// 2×3 board:  [a a b]
//             [c c b]
function buildGame() {
  const rect = (id, width, height, row, col) => ({
    id,
    width,
    height,
    area: width * height,
    solution: { row, col, width, height },
    currentPosition: null,
    status: 'available',
    locked: false,
  });
  return {
    rows: 2,
    columns: 3,
    clues: [
      { id: 'clue-a', row: 0, col: 0, value: 2 },
      { id: 'clue-b', row: 1, col: 2, value: 2 },
      { id: 'clue-c', row: 1, col: 1, value: 2 },
    ],
    rectangles: [rect('rect-a', 2, 1, 0, 0), rect('rect-b', 1, 2, 0, 2), rect('rect-c', 2, 1, 1, 0)],
  };
}

const lockAt = (rect, row, col) => Object.assign(rect, { currentPosition: { row, col }, locked: true, status: 'locked' });
const lockAllOnSolution = (game) => game.rectangles.forEach((r) => lockAt(r, r.solution.row, r.solution.col));

describe('validation.service — partition checks', () => {
  test('detects a valid partition', () => {
    const boxes = buildGame().rectangles.map((r) => r.solution);
    expect(isValidPartition(2, 3, boxes)).toBe(true);
  });

  test('detects gaps, overlaps and out-of-board boxes', () => {
    expect(analyzePartition(2, 3, [{ row: 0, col: 0, width: 3, height: 1 }]).uncoveredCells).toBe(3);
    const overlapping = [
      { row: 0, col: 0, width: 2, height: 2 },
      { row: 0, col: 1, width: 2, height: 2 },
    ];
    expect(analyzePartition(2, 3, overlapping).overlappingCells).toBe(2);
    expect(analyzePartition(2, 3, [{ row: 1, col: 2, width: 2, height: 1 }]).outOfBoard).toBe(1);
  });
});

describe('validation.service — win condition', () => {
  test('incomplete puzzle is not solved', () => {
    const game = buildGame();
    lockAt(game.rectangles[0], 0, 0);
    const result = checkSolved(game);
    expect(result.solved).toBe(false);
    expect(result.reason).toMatch(/still to place/);
  });

  test('incorrect placement is not solved', () => {
    const game = buildGame();
    lockAllOnSolution(game);
    lockAt(game.rectangles[0], 1, 0); // a on c's row — wrong slot and overlapping
    expect(checkSolved(game).solved).toBe(false);
  });

  test('correct puzzle is solved', () => {
    const game = buildGame();
    lockAllOnSolution(game);
    expect(checkSolved(game)).toEqual({ solved: true, reason: null });
  });

  test('empty puzzle is never solved', () => {
    expect(checkSolved({ rows: 3, columns: 3, clues: [], rectangles: [] }).solved).toBe(false);
  });

  test('progress reports locked / total / percent', () => {
    const game = buildGame();
    lockAt(game.rectangles[0], 0, 0);
    expect(getProgress(game)).toEqual({ locked: 1, total: 3, percent: 33 });
  });
});

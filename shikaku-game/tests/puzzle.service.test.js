'use strict';

const { generatePuzzle, generatePartition, countSolutions } = require('../src/services/puzzle.service');
const { isValidPartition, analyzePartition } = require('../src/services/validation.service');
const { getCluesInside, isInsideBoard, boxesOverlap } = require('../src/services/rectangle.service');
const { GAME_CONFIG, DIFFICULTIES } = require('../src/config/game.config');
const { createSeededRandom } = require('../src/utils/random');

const SIZES = [
  [3, 3],
  [5, 5],
  [7, 7],
  [9, 9],
  [10, 10],
  [4, 8],
  [10, 3],
];

describe('puzzle.service — generatePuzzle', () => {
  const cases = [];
  SIZES.forEach(([rows, columns]) => {
    DIFFICULTIES.forEach((difficulty) => {
      for (let seed = 1; seed <= 8; seed += 1) cases.push({ rows, columns, difficulty, seed });
    });
  });
  const generated = cases.map((c) => ({ ...c, puzzle: generatePuzzle(c.rows, c.columns, c.difficulty, { rng: createSeededRandom(c.seed) }) }));
  const boxesOf = (puzzle) => puzzle.rectangles.map((r) => r.solution);

  test('board is completely covered', () => {
    generated.forEach(({ rows, columns, puzzle }) => {
      expect(analyzePartition(rows, columns, boxesOf(puzzle)).uncoveredCells).toBe(0);
      const area = puzzle.rectangles.reduce((sum, r) => sum + r.area, 0);
      expect(area).toBe(rows * columns);
    });
  });

  test('rectangles do not overlap', () => {
    generated.forEach(({ puzzle }) => {
      const boxes = boxesOf(puzzle);
      boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(boxesOverlap(a, b)).toBe(false)));
    });
  });

  test('every rectangle is inside the board', () => {
    generated.forEach(({ rows, columns, puzzle }) => {
      boxesOf(puzzle).forEach((box) => expect(isInsideBoard(box, rows, columns)).toBe(true));
      expect(isValidPartition(rows, columns, boxesOf(puzzle))).toBe(true);
    });
  });

  test('every rectangle has valid dimensions', () => {
    generated.forEach(({ puzzle }) => {
      puzzle.rectangles.forEach((r) => {
        expect(r.width).toBeGreaterThanOrEqual(GAME_CONFIG.minRectangleWidth);
        expect(r.width).toBeLessThanOrEqual(GAME_CONFIG.maxRectangleWidth);
        expect(r.height).toBeGreaterThanOrEqual(GAME_CONFIG.minRectangleHeight);
        expect(r.height).toBeLessThanOrEqual(GAME_CONFIG.maxRectangleHeight);
        expect(r.area).toBe(r.width * r.height);
        expect(r.solution).toMatchObject({ width: r.width, height: r.height });
      });
    });
  });

  test('every rectangle contains exactly one clue, and it is its own clue', () => {
    generated.forEach(({ puzzle }) => {
      expect(puzzle.clues).toHaveLength(puzzle.rectangles.length);
      puzzle.rectangles.forEach((r) => {
        const inside = getCluesInside(r.solution, puzzle.clues);
        expect(inside).toHaveLength(1);
        expect(inside[0].id).toBe(r.clueId);
      });
    });
  });

  test('clue value equals rectangle area', () => {
    generated.forEach(({ puzzle }) => {
      puzzle.rectangles.forEach((r) => {
        const clue = puzzle.clues.find((c) => c.id === r.clueId);
        expect(clue.value).toBe(r.area);
      });
    });
  });

  test('puzzles flagged as unique really have exactly one solution', () => {
    generated.forEach(({ rows, columns, puzzle }) => {
      const expected = puzzle.uniqueSolution ? 1 : expect.any(Number);
      expect(countSolutions(rows, columns, puzzle.clues).count).toEqual(expected);
      expect(countSolutions(rows, columns, puzzle.clues).count).toBeGreaterThanOrEqual(1);
    });
    const uniqueShare = generated.filter((g) => g.puzzle.uniqueSolution).length / generated.length;
    expect(uniqueShare).toBeGreaterThan(0.95);
  });

  test('generates fresh IDs every time', () => {
    const a = generatePuzzle(5, 5, 'easy');
    const b = generatePuzzle(5, 5, 'easy');
    const idsA = new Set(a.rectangles.map((r) => r.id));
    b.rectangles.forEach((r) => expect(idsA.has(r.id)).toBe(false));
  });
});

describe('puzzle.service — generatePartition', () => {
  test('returns null when limits make coverage impossible', () => {
    const limits = { minWidth: 2, maxWidth: 2, minHeight: 2, maxHeight: 2 };
    expect(generatePartition(3, 3, { limits })).toBeNull();
  });
});

describe('puzzle.service — countSolutions', () => {
  test('counts a trivially unique puzzle', () => {
    // 2×2 board fully covered by one "4" clue.
    expect(countSolutions(2, 2, [{ row: 0, col: 0, value: 4 }]).count).toBe(1);
  });

  test('detects multiple solutions', () => {
    // Two "2" clues on opposite corners of a 2×2 board: horizontal or vertical split.
    const clues = [
      { row: 0, col: 0, value: 2 },
      { row: 1, col: 1, value: 2 },
    ];
    expect(countSolutions(2, 2, clues).count).toBe(2);
  });

  test('returns zero when clue areas do not sum to the board', () => {
    expect(countSolutions(3, 3, [{ row: 0, col: 0, value: 4 }]).count).toBe(0);
  });
});

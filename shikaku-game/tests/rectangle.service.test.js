'use strict';

const rectangleService = require('../src/services/rectangle.service');
const { RECTANGLE_STATUS } = require('../src/config/game.config');

// Solution layout (3×3):
//   r0: [a a b]
//   r1: [c c b]
//   r2: [c c b]
// a = 2×1 at (0,0), b = 1×3 at (0,2), c = 2×2 at (1,0)
function buildGame() {
  const clues = [
    { id: 'clue-a', row: 0, col: 1, value: 2 },
    { id: 'clue-b', row: 2, col: 2, value: 3 },
    { id: 'clue-c', row: 1, col: 0, value: 4 },
  ];
  const rect = (id, width, height, row, col, clueId) => ({
    id,
    width,
    height,
    area: width * height,
    clueId,
    solution: { row, col, width, height },
    currentPosition: null,
    status: RECTANGLE_STATUS.AVAILABLE,
    selected: false,
    locked: false,
  });
  return {
    rows: 3,
    columns: 3,
    clues,
    rectangles: [rect('rect-a', 2, 1, 0, 0, 'clue-a'), rect('rect-b', 1, 3, 0, 2, 'clue-b'), rect('rect-c', 2, 2, 1, 0, 'clue-c')],
  };
}

describe('rectangle.service — geometry helpers', () => {
  test('isInsideBoard', () => {
    expect(rectangleService.isInsideBoard({ row: 0, col: 0, width: 3, height: 3 }, 3, 3)).toBe(true);
    expect(rectangleService.isInsideBoard({ row: 1, col: 2, width: 2, height: 1 }, 3, 3)).toBe(false);
    expect(rectangleService.isInsideBoard({ row: -1, col: 0, width: 1, height: 1 }, 3, 3)).toBe(false);
  });

  test('hasOverlap', () => {
    const locked = [{ row: 0, col: 0, width: 2, height: 1 }];
    expect(rectangleService.hasOverlap({ row: 0, col: 1, width: 1, height: 2 }, locked)).toBe(true);
    expect(rectangleService.hasOverlap({ row: 1, col: 0, width: 2, height: 2 }, locked)).toBe(false);
  });

  test('containsClue requires exactly one clue', () => {
    const { clues } = buildGame();
    expect(rectangleService.containsClue({ row: 0, col: 0, width: 2, height: 1 }, clues)).toBe(true);
    expect(rectangleService.containsClue({ row: 0, col: 0, width: 2, height: 2 }, clues)).toBe(false); // 2 clues
    expect(rectangleService.containsClue({ row: 0, col: 0, width: 1, height: 1 }, clues)).toBe(false); // none
  });

  test('hasCorrectArea', () => {
    expect(rectangleService.hasCorrectArea({ width: 2, height: 2 }, { value: 4 })).toBe(true);
    expect(rectangleService.hasCorrectArea({ width: 1, height: 3 }, { value: 4 })).toBe(false);
    expect(rectangleService.hasCorrectArea({ width: 1, height: 1 }, undefined)).toBe(false);
  });

  test('isCorrectSolutionPosition', () => {
    const [a] = buildGame().rectangles;
    expect(rectangleService.isCorrectSolutionPosition(a, { row: 0, col: 0 })).toBe(true);
    expect(rectangleService.isCorrectSolutionPosition(a, { row: 0, col: 1 })).toBe(false);
  });
});

describe('rectangle.service — validatePlacement', () => {
  test('valid placement accepted', () => {
    const game = buildGame();
    const verdict = rectangleService.validatePlacement(game, game.rectangles[0], { row: 0, col: 0 });
    expect(verdict.valid).toBe(true);
    expect(verdict.match).toBe(game.rectangles[0]);
  });

  test('invalid placement rejected (no clue / wrong area / wrong slot)', () => {
    const game = buildGame();
    const [a, b, c] = game.rectangles;
    // b (1×3) at column 0 covers clue-c (value 4): wrong area.
    expect(rectangleService.validatePlacement(game, b, { row: 0, col: 0 })).toMatchObject({ valid: false, code: 'INVALID_PLACEMENT' });
    // a (2×1) at (2,0) covers no clue.
    expect(rectangleService.validatePlacement(game, a, { row: 2, col: 0 })).toMatchObject({ valid: false, code: 'INVALID_PLACEMENT' });
    // c (2×2) at (0,0) covers two clues.
    expect(rectangleService.validatePlacement(game, c, { row: 0, col: 0 })).toMatchObject({ valid: false, code: 'INVALID_PLACEMENT' });
  });

  test('rule-valid placement that is not the solution is rejected', () => {
    const game = buildGame();
    const [a] = game.rectangles;
    // a (2×1) at (0,1) covers only clue-a (value 2) — fits the clue but breaks the partition.
    const verdict = rectangleService.validatePlacement(game, a, { row: 0, col: 1 });
    expect(verdict).toMatchObject({ valid: false, code: 'INVALID_PLACEMENT' });
  });

  test('out-of-board placement rejected', () => {
    const game = buildGame();
    const [, b] = game.rectangles;
    expect(rectangleService.validatePlacement(game, b, { row: 1, col: 2 })).toMatchObject({ valid: false, code: 'RECTANGLE_OUT_OF_BOARD' });
    expect(rectangleService.validatePlacement(game, b, { row: 5, col: 0 })).toMatchObject({ valid: false, code: 'INVALID_POSITION' });
  });

  test('overlapping placement rejected', () => {
    const game = buildGame();
    const [a, , c] = game.rectangles;
    rectangleService.lockRectangle(c, { row: 1, col: 0 });
    // a (2×1) at (1,0) would sit on top of locked c.
    expect(rectangleService.validatePlacement(game, a, { row: 1, col: 0 })).toMatchObject({ valid: false, code: 'RECTANGLE_OVERLAP' });
  });

  test('identical rectangles are interchangeable and swap solution slots', () => {
    const game = {
      rows: 1,
      columns: 4,
      clues: [
        { id: 'clue-1', row: 0, col: 0, value: 2 },
        { id: 'clue-2', row: 0, col: 3, value: 2 },
      ],
      rectangles: [
        { id: 'rect-1', width: 2, height: 1, area: 2, clueId: 'clue-1', solution: { row: 0, col: 0, width: 2, height: 1 }, status: 'available', locked: false },
        { id: 'rect-2', width: 2, height: 1, area: 2, clueId: 'clue-2', solution: { row: 0, col: 2, width: 2, height: 1 }, status: 'available', locked: false },
      ],
    };
    const [first, second] = game.rectangles;
    const verdict = rectangleService.validatePlacement(game, first, { row: 0, col: 2 });
    expect(verdict.valid).toBe(true);
    expect(verdict.match).toBe(second);
    rectangleService.lockRectangle(first, { row: 0, col: 2 }, verdict.match);
    expect(first.solution).toMatchObject({ row: 0, col: 2 });
    expect(second.solution).toMatchObject({ row: 0, col: 0 });
    expect(first.clueId).toBe('clue-2');
  });
});

describe('rectangle.service — status transitions', () => {
  test('lockRectangle locks the rectangle at the given position', () => {
    const [a] = buildGame().rectangles;
    rectangleService.lockRectangle(a, { row: 0, col: 0 });
    expect(a).toMatchObject({ status: 'locked', locked: true, selected: false, currentPosition: { row: 0, col: 0 } });
  });

  test('locked rectangle cannot move or be selected again', () => {
    const [a] = buildGame().rectangles;
    rectangleService.lockRectangle(a, { row: 0, col: 0 });
    expect(() => rectangleService.transition(a, RECTANGLE_STATUS.SELECTED)).toThrow(expect.objectContaining({ code: 'RECTANGLE_ALREADY_LOCKED' }));
    expect(() => rectangleService.transition(a, RECTANGLE_STATUS.PLACED)).toThrow(expect.objectContaining({ code: 'RECTANGLE_ALREADY_LOCKED' }));
  });

  test('available → locked directly is not allowed', () => {
    expect(rectangleService.canTransition('available', 'locked')).toBe(false);
    expect(rectangleService.canTransition('available', 'selected')).toBe(true);
    expect(rectangleService.canTransition('placed', 'locked')).toBe(true);
  });
});

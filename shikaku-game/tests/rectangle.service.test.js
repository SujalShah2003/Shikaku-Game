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

describe('rectangle.service — validatePlacement (drawn boxes)', () => {
  const box = (row, col, width, height) => ({ row, col, width, height });

  test('valid placement accepted and matched to its solution rectangle', () => {
    const game = buildGame();
    const verdict = rectangleService.validatePlacement(game, box(0, 0, 2, 1));
    expect(verdict.valid).toBe(true);
    expect(verdict.rectangle.id).toBe('rect-a');
  });

  test('invalid placement rejected (wrong area / no clue / two clues)', () => {
    const game = buildGame();
    // 1×3 down column 0 covers clue-c (value 4): wrong area.
    expect(rectangleService.validatePlacement(game, box(0, 0, 1, 3))).toMatchObject({ valid: false, code: 'INVALID_PLACEMENT' });
    // 2×1 on the bottom row covers no clue.
    expect(rectangleService.validatePlacement(game, box(2, 0, 2, 1))).toMatchObject({ valid: false, code: 'INVALID_PLACEMENT' });
    // 2×2 in the corner covers two clues.
    expect(rectangleService.validatePlacement(game, box(0, 0, 2, 2))).toMatchObject({ valid: false, code: 'INVALID_PLACEMENT' });
  });

  test('rule-valid box that is not in the solution is rejected', () => {
    // 2×1 at (0,1) covers only clue-a (value 2) — fits the clue but breaks the partition.
    expect(rectangleService.validatePlacement(buildGame(), box(0, 1, 2, 1))).toMatchObject({ valid: false, code: 'INVALID_PLACEMENT' });
  });

  test('box larger than the configured maximum is rejected', () => {
    const game = { rows: 1, columns: 4, clues: [{ id: 'c', row: 0, col: 0, value: 4 }], rectangles: [] };
    const verdict = rectangleService.validatePlacement(game, box(0, 0, 4, 1));
    expect(verdict).toMatchObject({ valid: false, code: 'INVALID_PLACEMENT' });
    expect(verdict.message).toMatch(/at most 3 wide/);
  });

  test('out-of-board placement rejected', () => {
    const game = buildGame();
    expect(rectangleService.validatePlacement(game, box(1, 2, 1, 3))).toMatchObject({ valid: false, code: 'RECTANGLE_OUT_OF_BOARD' });
    expect(rectangleService.validatePlacement(game, box(5, 0, 1, 1))).toMatchObject({ valid: false, code: 'INVALID_POSITION' });
  });

  test('overlapping placement rejected', () => {
    const game = buildGame();
    rectangleService.lockRectangle(game.rectangles[2], { row: 1, col: 0 }); // lock c
    expect(rectangleService.validatePlacement(game, box(1, 0, 2, 1))).toMatchObject({ valid: false, code: 'RECTANGLE_OVERLAP' });
  });

  test('a locked rectangle is never matched again', () => {
    const game = buildGame();
    rectangleService.lockRectangle(game.rectangles[0], { row: 0, col: 0 });
    expect(rectangleService.findRectangleForBox(game.rectangles, box(0, 0, 2, 1))).toBeNull();
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

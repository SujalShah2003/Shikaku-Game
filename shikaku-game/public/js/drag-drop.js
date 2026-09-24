/**
 * drag-drop.js — drawing rectangles directly on the grid, like classic Shikaku.
 *
 *   pointer   press on a cell, drag to the opposite corner, release to place
 *   keyboard  arrows move the cursor, Enter starts a rectangle, arrows size it,
 *             Enter places it, Esc cancels
 *
 * The rectangle always snaps to whole cells. The validity preview is only a hint
 * for the player; the server re-validates every placement and is the authority.
 */

function cellInBox(box, row, col) {
  return row >= box.row && row < box.row + box.height && col >= box.col && col < box.col + box.width;
}

function boxesOverlap(a, b) {
  return a.row < b.row + b.height && b.row < a.row + a.height && a.col < b.col + b.width && b.col < a.col + a.width;
}

/** Normalises two corner cells into { row, col, width, height }. */
export function boxFromCorners(a, b) {
  return {
    row: Math.min(a.row, b.row),
    col: Math.min(a.col, b.col),
    width: Math.abs(a.col - b.col) + 1,
    height: Math.abs(a.row - b.row) + 1,
  };
}

const lockedBoxes = (state) => state.rectangles.map((r) => ({ ...r.currentPosition, width: r.width, height: r.height }));

/** Client-side mirror of the rule checks, used purely for the preview colour/label. */
export function evaluateBox(state, box, limits) {
  if (box.width > limits.maxRectangleWidth || box.height > limits.maxRectangleHeight) {
    return { valid: false, reason: `max ${limits.maxRectangleWidth}×${limits.maxRectangleHeight}` };
  }
  if (lockedBoxes(state).some((other) => boxesOverlap(box, other))) return { valid: false, reason: 'overlaps' };
  const clues = state.clues.filter((clue) => cellInBox(box, clue.row, clue.col));
  const area = box.width * box.height;
  if (clues.length === 0) return { valid: false, reason: 'no number' };
  if (clues.length > 1) return { valid: false, reason: `${clues.length} numbers` };
  if (clues[0].value !== area) return { valid: false, reason: `needs ${clues[0].value}` };
  return { valid: true, reason: `fits ${clues[0].value}` };
}

export function createDragDrop({ board, layer, getState, limits, isPlayable, onSelect, onPlace, onBlocked, setHint }) {
  let draft = null; // { anchor, current, pointerId, selected }
  let cursor = { row: 0, col: 0 };
  let showCursor = false;
  let busy = false;
  let selecting = Promise.resolve(); // in-flight select, awaited before placing
  const preview = document.createElement('div');
  preview.className = 'preview';
  // The size label lives in a layer above the cells so numbers never cover it.
  const topLayer = document.createElement('div');
  topLayer.className = 'board-top';
  topLayer.setAttribute('aria-hidden', 'true');
  board.appendChild(topLayer);
  const tag = document.createElement('div');
  tag.className = 'preview-tag';
  tag.innerHTML = '<span class="preview-label"></span>';
  const cursorEl = document.createElement('div');
  cursorEl.className = 'cursor';

  const isLockedCell = (cell) => lockedBoxes(getState()).some((box) => cellInBox(box, cell.row, cell.col));
  const hasClue = (cell) => getState().clues.some((c) => c.row === cell.row && c.col === cell.col);

  function setBoxVars(node, box) {
    node.style.setProperty('--r', box.row);
    node.style.setProperty('--c', box.col);
    node.style.setProperty('--w', box.width);
    node.style.setProperty('--hgt', box.height);
  }

  /** Board cell under a pointer, clamped to the board so dragging past an edge still sizes to it. */
  function cellFromPoint(clientX, clientY) {
    const state = getState();
    const rect = board.getBoundingClientRect();
    const clamp = (value, max) => Math.min(max - 1, Math.max(0, value));
    return {
      row: clamp(Math.floor(((clientY - rect.top) / rect.height) * state.rows), state.rows),
      col: clamp(Math.floor(((clientX - rect.left) / rect.width) * state.columns), state.columns),
    };
  }

  function render() {
    if (draft) {
      const box = boxFromCorners(draft.anchor, draft.current);
      const verdict = evaluateBox(getState(), box, limits);
      setBoxVars(preview, box);
      setBoxVars(tag, box);
      preview.dataset.valid = String(verdict.valid);
      tag.dataset.valid = String(verdict.valid);
      tag.firstChild.textContent = `${box.width}×${box.height} · ${verdict.valid ? '✓' : '✕'} ${verdict.reason}`;
      if (preview.parentNode !== layer) layer.appendChild(preview);
      if (tag.parentNode !== topLayer) topLayer.appendChild(tag);
      setHint(`${box.width}×${box.height} rectangle (area ${box.width * box.height}): ${verdict.reason}. Release to place.`);
    } else {
      preview.remove();
      tag.remove();
    }
    board.dataset.drawing = String(Boolean(draft));

    if (showCursor && isPlayable()) {
      setBoxVars(cursorEl, { ...cursor, width: 1, height: 1 });
      if (cursorEl.parentNode !== layer) layer.appendChild(cursorEl);
    } else {
      cursorEl.remove();
    }
  }

  function cancel({ silent = false } = {}) {
    if (!draft) return;
    draft = null;
    render();
    if (!silent) setHint('Press on a cell and drag to draw a rectangle.');
  }

  function begin(cell, pointerId = null) {
    draft = { anchor: cell, current: cell, pointerId, selected: false };
    render();
  }

  /** Tells the server (and teammates) where drawing started — once per rectangle. */
  function announce() {
    if (!draft || draft.selected || isLockedCell(draft.anchor)) return;
    draft.selected = true;
    selecting = Promise.resolve(onSelect(draft.anchor)).catch(() => {});
  }

  function shake() {
    preview.classList.remove('shake');
    void preview.offsetWidth; // restart the animation
    preview.classList.add('shake');
  }

  async function commit() {
    if (!draft || busy) return;
    const box = boxFromCorners(draft.anchor, draft.current);
    busy = true;
    try {
      await selecting; // keep select → place ordered on the server
      const result = await onPlace(box);
      if (result && result.accepted) {
        cancel({ silent: true });
        setHint('That one fits. On to the next.');
      } else {
        preview.dataset.valid = 'false';
        tag.dataset.valid = 'false';
        shake();
        setTimeout(() => cancel({ silent: true }), 450);
      }
    } finally {
      busy = false;
    }
  }

  /* ---------- Pointer ---------- */

  board.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || busy || !getState()) return;
    if (!isPlayable()) {
      onBlocked();
      return;
    }
    event.preventDefault();
    showCursor = false;
    board.setPointerCapture(event.pointerId);
    begin(cellFromPoint(event.clientX, event.clientY), event.pointerId);
  });

  board.addEventListener('pointermove', (event) => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    const cell = cellFromPoint(event.clientX, event.clientY);
    if (cell.row === draft.current.row && cell.col === draft.current.col) return;
    draft.current = cell;
    announce();
    render();
  });

  board.addEventListener('pointerup', (event) => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    const box = boxFromCorners(draft.anchor, draft.current);
    // A plain click on an empty cell is not a move — just ignore it.
    if (box.width === 1 && box.height === 1 && !hasClue(draft.anchor)) {
      cancel();
      return;
    }
    commit();
  });

  board.addEventListener('pointercancel', () => cancel({ silent: true }));

  /* ---------- Keyboard ---------- */

  const MOVES = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  board.addEventListener('keydown', (event) => {
    const state = getState();
    if (!state) return;
    if (MOVES[event.key]) {
      event.preventDefault();
      const [dr, dc] = MOVES[event.key];
      cursor = {
        row: Math.min(state.rows - 1, Math.max(0, cursor.row + dr)),
        col: Math.min(state.columns - 1, Math.max(0, cursor.col + dc)),
      };
      showCursor = true;
      if (draft) {
        draft.current = cursor;
        announce();
      } else {
        setHint(`Row ${cursor.row + 1}, column ${cursor.col + 1}. Press Enter to start a rectangle here.`);
      }
      render();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isPlayable()) {
        onBlocked();
        return;
      }
      showCursor = true;
      if (draft) commit();
      else begin({ ...cursor });
    } else if (event.key === 'Escape' && draft) {
      cancel();
    }
  });

  board.addEventListener('focus', () => {
    showCursor = !draft && board.matches(':focus-visible');
    render();
  });

  board.addEventListener('blur', () => {
    showCursor = false;
    render();
  });

  /** Called after each state update: stop drawing if play stopped, refresh validity. */
  function sync() {
    const state = getState();
    if (state) {
      cursor = { row: Math.min(cursor.row, state.rows - 1), col: Math.min(cursor.col, state.columns - 1) };
    }
    if (draft && !isPlayable()) {
      cancel({ silent: true });
      return;
    }
    render();
  }

  return { sync, cancel, isDrawing: () => Boolean(draft) };
}

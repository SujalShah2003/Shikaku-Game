/**
 * drag-drop.js — dragging rectangles from the tray, snapping them to the grid
 * and previewing the placement. Three input styles share one code path:
 *   drag     press a piece and drag it onto the board
 *   armed    click/tap a piece, then click/tap a board cell
 *   keyboard Enter on a piece, arrow keys to move, Enter to place, Esc to cancel
 *
 * The preview check below is only a hint for the player; the server re-validates
 * every placement and is the sole authority.
 */

const DRAG_THRESHOLD_PX = 6;

function cellInBox(box, row, col) {
  return row >= box.row && row < box.row + box.height && col >= box.col && col < box.col + box.width;
}

function boxesOverlap(a, b) {
  return a.row < b.row + b.height && b.row < a.row + a.height && a.col < b.col + b.width && b.col < a.col + a.width;
}

/** Client-side mirror of the rule checks, used purely for the preview colour/label. */
export function evaluatePlacement(state, rect, pos) {
  const box = { row: pos.row, col: pos.col, width: rect.width, height: rect.height };
  if (box.row < 0 || box.col < 0 || box.row + box.height > state.rows || box.col + box.width > state.columns) {
    return { valid: false, label: '✕ Outside the board' };
  }
  const lockedBoxes = state.rectangles
    .filter((r) => r.locked && r.currentPosition && r.id !== rect.id)
    .map((r) => ({ ...r.currentPosition, width: r.width, height: r.height }));
  if (lockedBoxes.some((other) => boxesOverlap(box, other))) return { valid: false, label: '✕ Overlaps' };

  const clues = state.clues.filter((clue) => cellInBox(box, clue.row, clue.col));
  if (clues.length === 0) return { valid: false, label: '✕ No number' };
  if (clues.length > 1) return { valid: false, label: `✕ ${clues.length} numbers` };
  if (clues[0].value !== rect.area) return { valid: false, label: `✕ Needs ${clues[0].value}` };
  return { valid: true, label: `✓ Fits ${clues[0].value}` };
}

export function createDragDrop({ board, layer, tray, getState, isPlayable, onSelect, onPlace, onBlocked, onChange, setHint }) {
  let active = null; // { rect, mode, grabRow, grabCol, pos, ghost }
  let pending = null; // pointer pressed on a piece, not yet dragged
  let preview = null;
  let busy = false;

  const findRect = (id) => getState()?.rectangles.find((r) => r.id === id && !r.locked) || null;

  function metrics() {
    const state = getState();
    const box = board.getBoundingClientRect();
    return { box, cellW: box.width / state.columns, cellH: box.height / state.rows, state };
  }

  function inGrid(pos) {
    const state = getState();
    return pos.row >= 0 && pos.col >= 0 && pos.row < state.rows && pos.col < state.columns;
  }

  /** Snaps a pointer position to the rectangle's top-left cell, honouring where it was grabbed. */
  function snapFromPoint(clientX, clientY) {
    const { box, cellW, cellH } = metrics();
    const margin = Math.min(cellW, cellH) * 0.5;
    const outside =
      clientX < box.left - margin || clientX > box.right + margin || clientY < box.top - margin || clientY > box.bottom + margin;
    if (outside) return null;
    return {
      row: Math.floor((clientY - box.top) / cellH) - active.grabRow,
      col: Math.floor((clientX - box.left) / cellW) - active.grabCol,
    };
  }

  function ensurePreview() {
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'preview';
      preview.innerHTML = '<span class="preview-label"></span>';
    }
    if (preview.parentNode !== layer) layer.appendChild(preview);
    return preview;
  }

  function hidePreview() {
    if (preview) preview.remove();
  }

  function renderPreview() {
    if (!active || !active.pos) {
      hidePreview();
      return;
    }
    const verdict = evaluatePlacement(getState(), active.rect, active.pos);
    const node = ensurePreview();
    node.style.setProperty('--r', active.pos.row);
    node.style.setProperty('--c', active.pos.col);
    node.style.setProperty('--w', active.rect.width);
    node.style.setProperty('--hgt', active.rect.height);
    node.dataset.valid = String(verdict.valid);
    node.querySelector('.preview-label').textContent = verdict.label;
    setHint(`${active.rect.width}×${active.rect.height} at row ${active.pos.row + 1}, column ${active.pos.col + 1}: ${verdict.label.slice(2)}`);
  }

  function buildGhost(rect) {
    const { cellW, cellH } = metrics();
    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.gridTemplateColumns = `repeat(${rect.width}, ${cellW}px)`;
    ghost.style.gridTemplateRows = `repeat(${rect.height}, ${cellH}px)`;
    for (let i = 0; i < rect.area; i += 1) ghost.appendChild(document.createElement('span'));
    document.body.appendChild(ghost);
    return ghost;
  }

  function moveGhost(clientX, clientY) {
    const { cellW, cellH } = metrics();
    const x = clientX - (active.grabCol + 0.5) * cellW;
    const y = clientY - (active.grabRow + 0.5) * cellH;
    active.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function activate(rect, mode, grab) {
    cancel({ silent: true });
    active = { rect, mode, grabRow: grab.row, grabCol: grab.col, pos: null, ghost: null };
    board.dataset.armed = String(mode !== 'drag');
    onSelect(rect);
    onChange();
  }

  function cancel({ silent = false } = {}) {
    if (!active) return;
    if (active.ghost) active.ghost.remove();
    active = null;
    delete document.body.dataset.dragging;
    board.dataset.armed = 'false';
    hidePreview();
    if (!silent) setHint('Drag a rectangle from the tray onto the board.');
    onChange();
  }

  async function commit() {
    if (!active || !active.pos || busy) return;
    const { rect, pos } = active;
    if (!inGrid(pos)) {
      preview?.classList.remove('shake');
      void preview?.offsetWidth;
      preview?.classList.add('shake');
      setHint('That spot is off the board — try again.');
      return;
    }
    busy = true;
    try {
      const result = await onPlace(rect, pos);
      if (result && result.accepted) {
        cancel({ silent: true });
        setHint('Locked in! Pick the next rectangle.');
      } else if (preview) {
        preview.dataset.valid = 'false';
        preview.classList.remove('shake');
        void preview.offsetWidth;
        preview.classList.add('shake');
        setTimeout(() => cancel({ silent: true }), 450);
      } else {
        cancel({ silent: true });
      }
    } finally {
      busy = false;
    }
  }

  /* ---------- Pointer: press → (drag | click-to-arm) ---------- */

  function grabFromPointer(pieceEl, rect, clientX, clientY) {
    const shape = pieceEl.querySelector('.piece-shape').getBoundingClientRect();
    const fx = (clientX - shape.left) / shape.width;
    const fy = (clientY - shape.top) / shape.height;
    const clamp = (value, max) => Math.min(max - 1, Math.max(0, Math.floor(value * max)));
    return { row: clamp(fy, rect.height), col: clamp(fx, rect.width) };
  }

  function onPointerMove(event) {
    if (pending && event.pointerId === pending.pointerId && !active?.ghost) {
      const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
      if (distance < DRAG_THRESHOLD_PX) return;
      const rect = findRect(pending.id);
      if (!rect) return;
      activate(rect, 'drag', pending.grab);
      active.ghost = buildGhost(rect);
      document.body.dataset.dragging = 'true';
    }
    if (active && active.mode === 'drag' && active.ghost) {
      event.preventDefault();
      moveGhost(event.clientX, event.clientY);
      active.pos = snapFromPoint(event.clientX, event.clientY);
      active.ghost.dataset.snapped = String(Boolean(active.pos));
      renderPreview();
    }
  }

  function onPointerUp(event) {
    if (!pending || event.pointerId !== pending.pointerId) return;
    const wasDrag = active && active.mode === 'drag' && active.ghost;
    const { id } = pending;
    pending = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    if (wasDrag) {
      active.ghost.remove();
      active.ghost = null;
      delete document.body.dataset.dragging;
      if (event.type === 'pointercancel' || !active.pos) {
        cancel({ silent: true });
        setHint('Dropped outside the board.');
        return;
      }
      onChange();
      commit();
      return;
    }
    // A press without movement is a click: toggle "armed" mode for that piece.
    if (active && active.rect.id === id) {
      cancel();
      return;
    }
    const rect = findRect(id);
    if (!rect) return;
    activate(rect, 'armed', { row: Math.floor((rect.height - 1) / 2), col: Math.floor((rect.width - 1) / 2) });
    setHint(`${rect.width}×${rect.height} selected — click a cell on the board to place it.`);
  }

  tray.addEventListener('pointerdown', (event) => {
    const pieceEl = event.target.closest('.piece');
    if (!pieceEl || event.button !== 0 || busy) return;
    if (!isPlayable()) {
      onBlocked();
      return;
    }
    const rect = findRect(pieceEl.dataset.id);
    if (!rect) return;
    event.preventDefault(); // stop text selection / touch scrolling while dragging
    pending = {
      id: rect.id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      grab: grabFromPointer(pieceEl, rect, event.clientX, event.clientY),
    };
    // Window-level listeners survive the tray being re-rendered mid-drag.
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  /* ---------- Keyboard activation of a piece ---------- */

  tray.addEventListener('click', (event) => {
    const pieceEl = event.target.closest('.piece');
    if (!pieceEl || event.detail !== 0) return; // detail 0 ⇒ keyboard-triggered click
    if (!isPlayable()) {
      onBlocked();
      return;
    }
    const rect = findRect(pieceEl.dataset.id);
    if (!rect) return;
    activate(rect, 'keyboard', { row: 0, col: 0 });
    active.pos = { row: 0, col: 0 };
    renderPreview();
    board.focus();
  });

  /* ---------- Board: hover preview, click to place, keyboard moves ---------- */

  board.addEventListener('pointermove', (event) => {
    if (!active || active.mode === 'drag' || event.pointerType === 'touch') return;
    active.pos = snapFromPoint(event.clientX, event.clientY);
    renderPreview();
  });

  board.addEventListener('pointerleave', () => {
    if (active && active.mode === 'armed') {
      active.pos = null;
      renderPreview();
    }
  });

  board.addEventListener('pointerup', (event) => {
    if (!active || active.mode === 'drag' || event.button !== 0) return;
    active.pos = snapFromPoint(event.clientX, event.clientY);
    renderPreview();
    commit();
  });

  board.addEventListener('keydown', (event) => {
    if (!active || active.mode === 'drag') return;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[event.key]) {
      event.preventDefault();
      const state = getState();
      const pos = active.pos || { row: 0, col: 0 };
      const [dr, dc] = moves[event.key];
      active.pos = {
        row: Math.min(state.rows - 1, Math.max(0, pos.row + dr)),
        col: Math.min(state.columns - 1, Math.max(0, pos.col + dc)),
      };
      renderPreview();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active) {
      const { id } = active.rect;
      cancel();
      tray.querySelector(`[data-id="${id}"]`)?.focus();
    }
  });

  /** Called after each state update: drop the active piece if it vanished, refresh the preview. */
  function sync() {
    if (!active) return;
    if (!isPlayable() || !findRect(active.rect.id)) {
      cancel({ silent: true });
      return;
    }
    renderPreview();
  }

  return {
    sync,
    cancel,
    getActiveId: () => (active ? active.rect.id : null),
    isDragging: () => Boolean(active && active.ghost),
  };
}

/**
 * ui.js — all DOM rendering: board, tray, stats, timer, overlays, toasts, modal.
 * Holds no game logic; it renders whatever state game.js hands it.
 */

const HUES = [188, 268, 318, 142, 40, 212, 350, 165, 292, 100];
const TOAST_ICONS = { success: '✓', error: '✕', info: 'ℹ' };

const $ = (id) => document.getElementById(id);

export function hueFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[hash % HUES.length];
}

export function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

export const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '');

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function setBoxVars(node, { row, col, width, height }) {
  node.style.setProperty('--r', row);
  node.style.setProperty('--c', col);
  node.style.setProperty('--w', width);
  node.style.setProperty('--hgt', height);
}

function coversCell(rect, row, col) {
  const p = rect.currentPosition;
  return p && row >= p.row && row < p.row + rect.height && col >= p.col && col < p.col + rect.width;
}

export function getOverlayMode(state) {
  if (!state) return 'loading';
  if (state.status === 'created') return 'start';
  if (state.status === 'playing' && !state.timer.running) return 'paused';
  return 'none';
}

export function createUI() {
  const els = {
    board: $('board'),
    cells: $('board-cells'),
    layer: $('board-layer'),
    overlay: $('board-overlay'),
    boardSize: $('board-size'),
    statusBadge: $('status-badge'),
    hint: $('placement-hint'),
    tray: $('tray'),
    trayCount: $('tray-count'),
    trayEmpty: $('tray-empty'),
    headerTimer: $('header-timer'),
    headerDifficulty: $('header-difficulty'),
    connection: $('connection'),
    connectionLabel: $('connection-label'),
    players: $('players'),
    playersCount: $('players-count'),
    statTime: $('stat-time'),
    statRectangles: $('stat-rectangles'),
    statPercent: $('stat-percent'),
    statMoves: $('stat-moves'),
    statDifficulty: $('stat-difficulty'),
    progress: $('progress'),
    progressFill: $('progress-fill'),
    progressText: $('progress-text'),
    pauseBtn: $('pause-btn'),
    checkBtn: $('check-btn'),
    toasts: $('toasts'),
    modal: $('win-modal'),
    confetti: $('confetti'),
  };

  let boardKey = null;
  let lockedIds = new Set();

  function renderBoard(state) {
    const key = `${state.gameId}:${state.rows}x${state.columns}:${state.clues.map((c) => c.id).join(',')}`;
    const isNewPuzzle = key !== boardKey;
    els.board.style.setProperty('--rows', state.rows);
    els.board.style.setProperty('--cols', state.columns);
    els.boardSize.textContent = `${state.rows} × ${state.columns}`;

    if (isNewPuzzle) {
      boardKey = key;
      lockedIds = new Set();
      const clueAt = new Map(state.clues.map((clue) => [`${clue.row}:${clue.col}`, clue]));
      const fragment = document.createDocumentFragment();
      for (let row = 0; row < state.rows; row += 1) {
        for (let col = 0; col < state.columns; col += 1) {
          const clue = clueAt.get(`${row}:${col}`);
          const cell = el('div', 'cell', { role: 'gridcell', 'data-row': row, 'data-col': col });
          if (col === state.columns - 1) cell.dataset.lastCol = '';
          if (row === state.rows - 1) cell.dataset.lastRow = '';
          cell.setAttribute('aria-label', `Row ${row + 1}, column ${col + 1}${clue ? `, number ${clue.value}` : ''}`);
          if (clue) {
            const badge = el('span', 'clue', { 'data-clue-id': clue.id });
            badge.textContent = clue.value;
            cell.appendChild(badge);
          }
          fragment.appendChild(cell);
        }
      }
      els.cells.replaceChildren(fragment);
    }

    const locked = state.rectangles.filter((r) => r.locked && r.currentPosition);
    els.layer.querySelectorAll('.placed-rect').forEach((node) => node.remove());
    locked.forEach((rect) => {
      const node = el('div', 'placed-rect', { 'data-id': rect.id });
      setBoxVars(node, { ...rect.currentPosition, width: rect.width, height: rect.height });
      node.style.setProperty('--h', hueFor(rect.id));
      if (!isNewPuzzle && !lockedIds.has(rect.id)) node.classList.add('just-locked');
      const tag = el('span', 'rect-tag');
      tag.textContent = `${rect.width}×${rect.height}`;
      node.appendChild(tag);
      els.layer.prepend(node);
    });
    lockedIds = new Set(locked.map((r) => r.id));

    state.clues.forEach((clue) => {
      const badge = els.cells.querySelector(`[data-clue-id="${clue.id}"]`);
      if (!badge) return;
      const owner = locked.find((rect) => coversCell(rect, clue.row, clue.col));
      badge.dataset.covered = String(Boolean(owner));
      if (owner) badge.style.setProperty('--h', hueFor(owner.id));
    });
  }

  function renderTray(state, { activeId = null, dragging = false, playable = false } = {}) {
    const pieces = state.rectangles
      .filter((r) => !r.locked)
      .sort((a, b) => b.area - a.area || b.width - a.width || a.id.localeCompare(b.id));

    const fragment = document.createDocumentFragment();
    pieces.forEach((rect) => {
      const button = el('button', 'piece', {
        type: 'button',
        'data-id': rect.id,
        'aria-pressed': String(rect.id === activeId),
        'aria-label': `Rectangle ${rect.width} wide by ${rect.height} tall, area ${rect.area}`,
      });
      button.disabled = !playable;
      if (rect.selected) button.dataset.remoteSelected = 'true';
      if (dragging && rect.id === activeId) button.dataset.dragging = 'true';

      const shape = el('span', 'piece-shape', { 'aria-hidden': 'true' });
      shape.style.setProperty('--w', rect.width);
      shape.style.setProperty('--hgt', rect.height);
      for (let i = 0; i < rect.area; i += 1) shape.appendChild(document.createElement('span'));

      const label = el('span', 'piece-label', { 'aria-hidden': 'true' });
      label.innerHTML = `<b>${rect.width}×${rect.height}</b> · ${rect.area}`;
      button.append(shape, label);
      fragment.appendChild(button);
    });
    els.tray.replaceChildren(fragment);
    els.trayCount.textContent = `${pieces.length} left`;
    els.trayEmpty.hidden = pieces.length > 0 || state.rectangles.length === 0;
  }

  function renderStats(state) {
    const { locked, total, percent } = state.progress;
    els.statRectangles.textContent = `${locked} / ${total}`;
    els.statPercent.textContent = `${percent}%`;
    els.statMoves.textContent = String(state.moves);
    els.statDifficulty.textContent = capitalize(state.difficulty);
    els.headerDifficulty.textContent = capitalize(state.difficulty);
    els.progressFill.style.width = `${percent}%`;
    els.progress.setAttribute('aria-valuenow', String(percent));
    els.progress.setAttribute('aria-valuetext', `${locked} of ${total} rectangles locked`);
    els.progressText.textContent = `${locked} / ${total} locked`;
  }

  function renderStatus(state) {
    const mode = getOverlayMode(state);
    els.overlay.dataset.mode = mode;
    const running = state.status === 'playing' && state.timer.running;
    const label = { created: 'Ready', playing: running ? 'Playing' : 'Paused', completed: 'Solved' }[state.status];
    els.statusBadge.textContent = label;
    els.statusBadge.dataset.status = mode === 'paused' ? 'paused' : state.status;

    els.pauseBtn.disabled = state.status !== 'playing';
    els.pauseBtn.textContent = running || state.status !== 'playing' ? '❚❚ Pause' : '▶ Resume';
    els.checkBtn.disabled = state.status !== 'playing';

    const radio = document.querySelector(`input[name="difficulty"][value="${state.difficulty}"]`);
    if (radio && document.activeElement?.name !== 'difficulty') radio.checked = true;
  }

  function render(state, trayOptions) {
    renderBoard(state);
    renderTray(state, trayOptions);
    renderStats(state);
    renderStatus(state);
  }

  function renderTimer(seconds) {
    const text = formatTime(seconds);
    els.headerTimer.textContent = text;
    els.statTime.textContent = text;
  }

  const CONNECTION_LABELS = {
    connected: 'Connected',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    offline: 'Offline — using HTTP',
  };

  function setConnection(status) {
    els.connection.dataset.state = status;
    els.connectionLabel.textContent = CONNECTION_LABELS[status] || status;
  }

  function setPlayers(count) {
    els.players.hidden = count < 2;
    els.playersCount.textContent = String(count);
    els.players.setAttribute('aria-label', `${count} players viewing this game`);
  }

  function setHint(text) {
    els.hint.textContent = text;
  }

  function toast(message, type = 'info', duration = 3200) {
    const node = el('div', 'toast', { 'data-type': type });
    const icon = el('span', 'toast-icon', { 'aria-hidden': 'true' });
    icon.textContent = TOAST_ICONS[type] || TOAST_ICONS.info;
    const text = el('span');
    text.textContent = message;
    node.append(icon, text);
    els.toasts.appendChild(node);
    while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
    setTimeout(() => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 260);
    }, duration);
  }

  function launchConfetti() {
    const colors = ['#22e4ff', '#9d6bff', '#ff4fd8', '#7dff9b', '#ffc857'];
    const pieces = Array.from({ length: 36 }, (_, i) => {
      const bit = document.createElement('i');
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
      bit.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
      bit.style.setProperty('--dur', `${1.6 + Math.random() * 1.2}s`);
      bit.style.setProperty('--delay', `${Math.random() * 0.4}s`);
      return bit;
    });
    els.confetti.replaceChildren(...pieces);
  }

  function showWin(state) {
    $('win-time').textContent = formatTime(state.elapsedSeconds);
    $('win-rectangles').textContent = `${state.progress.locked} / ${state.progress.total}`;
    $('win-moves').textContent = String(state.moves);
    $('win-difficulty').textContent = capitalize(state.difficulty);
    els.board.classList.remove('solved');
    void els.board.offsetWidth; // restart the solved animation
    els.board.classList.add('solved');
    launchConfetti();
    if (!els.modal.open) els.modal.showModal();
    $('play-again-btn').focus();
  }

  function hideWin() {
    if (els.modal.open) els.modal.close();
  }

  return { els, render, renderTray, renderTimer, setConnection, setPlayers, setHint, toast, showWin, hideWin };
}

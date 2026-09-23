/**
 * game.js — entry point. Owns the client-side copy of the game state, talks to
 * the server (Socket.IO when connected, REST as a fallback — both hit the same
 * backend service) and wires the UI and drag-and-drop modules together.
 */
import { createUI, capitalize } from './ui.js';
import { createSocketClient } from './socket.js';
import { createDragDrop } from './drag-drop.js';

const config = JSON.parse(document.getElementById('app-config').textContent);
const PREFERRED_DIFFICULTY_KEY = 'shikaku:difficulty';

const ui = createUI();
let state = null;
let timerBase = { elapsed: 0, running: false, at: performance.now() };
const celebrated = new Set();

/* ---------- Storage (per-viewer preference only; never game state) ---------- */

function readPreferredDifficulty() {
  try {
    const value = localStorage.getItem(PREFERRED_DIFFICULTY_KEY);
    return config.difficulties.some((d) => d.key === value) ? value : config.defaultDifficulty;
  } catch {
    return config.defaultDifficulty;
  }
}

function savePreferredDifficulty(value) {
  try {
    localStorage.setItem(PREFERRED_DIFFICULTY_KEY, value);
  } catch {
    /* storage unavailable — preference simply isn't remembered */
  }
}

/* ---------- REST ---------- */

async function api(method, path, body) {
  try {
    const response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return await response.json();
  } catch {
    return { success: false, error: { code: 'NETWORK_ERROR', message: 'Network error — check your connection.' } };
  }
}

const gamePath = (suffix = '') => `/api/games/${encodeURIComponent(state.gameId)}${suffix}`;

/* ---------- State ---------- */

const isPlayable = () => Boolean(state && state.status === 'playing' && state.timer.running);

function currentElapsed() {
  if (!timerBase.running) return timerBase.elapsed;
  return timerBase.elapsed + Math.floor((performance.now() - timerBase.at) / 1000);
}

function syncTimer(timer) {
  if (!timer) return;
  timerBase = { elapsed: timer.elapsedSeconds, running: timer.running, at: performance.now() };
  ui.renderTimer(currentElapsed());
}

function puzzleKey(game) {
  return `${game.gameId}:${game.clues.map((c) => c.id).join(',')}`;
}

function renderAll() {
  ui.render(state, { activeId: drag.getActiveId(), dragging: drag.isDragging(), playable: isPlayable() });
}

/** Applies a server snapshot, ignoring stale ones that arrive out of order. */
function applyState(game) {
  if (!game || !game.gameId) return;
  if (state && state.gameId === game.gameId && game.version < state.version) return;
  state = game;
  syncTimer(game.timer);
  renderAll();
  drag.sync();

  const key = puzzleKey(game);
  if (game.status === 'completed' && !celebrated.has(key)) {
    celebrated.add(key);
    ui.showWin(game);
  }
}

function applyResponse(response) {
  const payload = response.data || (response.error && response.error.details);
  if (!payload) return;
  applyState(payload.game || (payload.gameId ? payload : null));
}

/* ---------- Transport: socket first, REST fallback ---------- */

async function send(event, payload, rest) {
  const response = socketClient.connected
    ? await socketClient.request(event, { gameId: state.gameId, ...payload })
    : await api(rest.method || 'POST', rest.path, rest.body ?? payload);
  applyResponse(response);
  return response;
}

function reportError(response, fallback = 'Something went wrong.') {
  if (!response.success) ui.toast((response.error && response.error.message) || fallback, 'error');
}

const actions = {
  async start() {
    reportError(await send('game:start', {}, { path: gamePath('/start') }));
  },
  async pause() {
    reportError(await send('timer:stop', {}, { path: gamePath('/timer/stop') }));
  },
  async select(rect) {
    const response = await send('rectangle:select', { rectangleId: rect.id }, { path: gamePath('/rectangles/select') });
    reportError(response);
  },
  async place(rect, pos) {
    const response = await send(
      'rectangle:place',
      { rectangleId: rect.id, row: pos.row, col: pos.col },
      { path: gamePath('/rectangles/place') },
    );
    if (!response.success) {
      reportError(response);
      return { accepted: false };
    }
    return { accepted: true };
  },
  async check() {
    const response = await send('game:check', {}, { path: gamePath('/check') });
    if (!response.success) return reportError(response);
    return ui.toast(response.message, response.solved ? 'success' : 'info');
  },
  async reset(difficulty) {
    const body = difficulty ? { difficulty } : {};
    const response = await send('game:reset', body, { path: gamePath('/reset'), body });
    if (response.success) ui.hideWin();
    reportError(response);
  },
};

/* ---------- Drag & drop ---------- */

const drag = createDragDrop({
  board: ui.els.board,
  layer: ui.els.layer,
  tray: ui.els.tray,
  getState: () => state,
  isPlayable,
  onSelect: (rect) => actions.select(rect),
  onPlace: (rect, pos) => actions.place(rect, pos),
  onBlocked: () => {
    if (!state) return;
    const message = state.status === 'completed' ? 'Puzzle solved! Start a new one to keep playing.' : state.status === 'created' ? 'Press Start to begin the puzzle.' : 'The game is paused — resume to keep playing.';
    ui.toast(message, 'info');
  },
  onChange: () => state && ui.renderTray(state, { activeId: drag.getActiveId(), dragging: drag.isDragging(), playable: isPlayable() }),
  setHint: ui.setHint,
});

/* ---------- Socket.IO ---------- */

const socketClient = createSocketClient({
  onStatus: ui.setConnection,
  onConnect: async () => {
    if (!state) return;
    const response = await socketClient.request('game:join', { gameId: state.gameId });
    applyResponse(response);
  },
  handlers: {
    'game:joined': ({ game }) => applyState(game),
    'game:updated': ({ game }) => applyState(game),
    'game:started': ({ game }) => applyState(game),
    'rectangle:selected': ({ game }) => applyState(game),
    'rectangle:moved': ({ game }) => applyState(game),
    'rectangle:locked': ({ game }) => applyState(game),
    'game:won': ({ game }) => applyState(game),
    'game:reset': ({ game }) => {
      drag.cancel({ silent: true });
      ui.hideWin();
      applyState(game);
      ui.toast(`New ${capitalize(game.difficulty)} puzzle generated.`, 'info');
    },
    'timer:updated': ({ timer }) => syncTimer(timer),
    'game:presence': ({ players }) => ui.setPlayers(players),
    'game:error': (error) => console.warn('[shikaku] server rejected', error.event, error.code),
  },
});

/* ---------- Bootstrapping ---------- */

async function createGame(difficulty) {
  return api('POST', '/api/games', { difficulty });
}

async function loadInitialGame() {
  const requestedId = new URLSearchParams(window.location.search).get('game');
  let response = requestedId ? await api('GET', `/api/games/${encodeURIComponent(requestedId)}`) : null;
  if (requestedId && !response.success) {
    ui.toast('That game could not be found — starting a new one.', 'info');
  }
  if (!response || !response.success) response = await createGame(readPreferredDifficulty());
  if (!response.success) {
    ui.toast(response.error.message, 'error', 8000);
    return;
  }
  applyState(response.data);
  const url = new URL(window.location.href);
  url.searchParams.set('game', state.gameId);
  window.history.replaceState(null, '', url);
  if (socketClient.connected) {
    applyResponse(await socketClient.request('game:join', { gameId: state.gameId }));
  }
}

function bindControls() {
  document.getElementById('start-btn').addEventListener('click', actions.start);
  document.getElementById('resume-btn').addEventListener('click', actions.start);
  document.getElementById('pause-btn').addEventListener('click', () => (isPlayable() ? actions.pause() : actions.start()));
  document.getElementById('check-btn').addEventListener('click', actions.check);

  const confirmReset = () => !state || state.moves === 0 || state.status === 'completed' || window.confirm('Discard this puzzle and generate a new one?');

  document.getElementById('reset-btn').addEventListener('click', () => confirmReset() && actions.reset());
  document.getElementById('new-game-btn').addEventListener('click', () => {
    const selected = document.querySelector('input[name="difficulty"]:checked');
    const difficulty = selected ? selected.value : state?.difficulty;
    savePreferredDifficulty(difficulty);
    if (confirmReset()) actions.reset(difficulty);
  });

  document.getElementById('play-again-btn').addEventListener('click', () => actions.reset());
  document.getElementById('close-modal-btn').addEventListener('click', ui.hideWin);

  document.getElementById('share-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      ui.toast('Link copied — open it in another window to play together.', 'success');
    } catch {
      ui.toast(`Share this link: ${window.location.href}`, 'info', 8000);
    }
  });
}

bindControls();
setInterval(() => ui.renderTimer(currentElapsed()), 250);
loadInitialGame();

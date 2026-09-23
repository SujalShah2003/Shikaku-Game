/**
 * socket.js — Socket.IO connection, connection-status reporting and a
 * promise-based request helper built on acknowledgements.
 * Connects to the page's own origin, so it works on localhost and on Render alike.
 */

const REQUEST_TIMEOUT_MS = 8000;

export function createSocketClient({ onStatus, onConnect, handlers }) {
  if (typeof window.io !== 'function') {
    onStatus('offline');
    return { get connected() { return false; }, request: async () => ({ success: false, error: { code: 'OFFLINE', message: 'Real-time connection unavailable.' } }) };
  }

  const socket = window.io({ reconnectionDelayMax: 5000 });
  onStatus('connecting');

  socket.on('connect', () => {
    onStatus('connected');
    onConnect();
  });
  socket.on('disconnect', (reason) => {
    // "io client disconnect" is intentional; everything else will auto-reconnect.
    onStatus(reason === 'io client disconnect' ? 'offline' : 'reconnecting');
  });
  socket.on('connect_error', () => onStatus('reconnecting'));
  socket.io.on('reconnect_failed', () => onStatus('offline'));

  Object.entries(handlers).forEach(([event, handler]) => socket.on(event, handler));

  return {
    get connected() {
      return socket.connected;
    },
    async request(event, payload) {
      try {
        return await socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck(event, payload);
      } catch {
        return { success: false, error: { code: 'TIMEOUT', message: 'The server did not respond in time.' } };
      }
    },
  };
}

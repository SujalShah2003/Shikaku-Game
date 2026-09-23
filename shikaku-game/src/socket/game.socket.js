'use strict';

const { GAME_EVENTS } = require('../services/game.service');
const { validate, socketSchemas } = require('../validators/game.validator');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

const roomOf = (gameId) => `game:${gameId}`;

function toErrorBody(err) {
  if (err instanceof AppError) return { code: err.code, message: err.message, details: err.details };
  logger.error({ err }, 'Unhandled socket error');
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong.' };
}

/**
 * Socket.IO adapter. Client events call the same game service as REST; the
 * service's domain events (fired after MongoDB is updated) are relayed to the
 * game room, so REST and socket actions both reach every connected client.
 */
function registerGameSocket(io, gameService) {
  Object.values(GAME_EVENTS).forEach((event) => {
    gameService.events.on(event, (payload) => io.to(roomOf(payload.gameId)).emit(event, payload));
  });

  const broadcastPresence = (gameId) => {
    const players = io.sockets.adapter.rooms.get(roomOf(gameId))?.size || 0;
    io.to(roomOf(gameId)).emit('game:presence', { gameId, players });
  };

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Socket connected');

    /** Registers a handler with validation, acknowledgement and `game:error` reporting. */
    const handle = (event, schema, action) => {
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const input = validate(schema, payload);
          reply(await action(input));
        } catch (err) {
          const error = toErrorBody(err);
          logger.warn({ socketId: socket.id, event, code: error.code }, 'Socket action failed');
          socket.emit('game:error', { event, ...error });
          reply({ success: false, error });
        }
      });
    };

    const ok = (data) => ({ success: true, data });

    handle('game:join', socketSchemas.gameOnly, async ({ gameId }) => {
      const game = await gameService.getGame(gameId);
      const previous = socket.data.gameId;
      if (previous && previous !== gameId) {
        socket.leave(roomOf(previous));
        broadcastPresence(previous);
      }
      socket.data.gameId = gameId;
      await socket.join(roomOf(gameId));
      logger.info({ socketId: socket.id, gameId }, 'Socket joined game');
      socket.emit('game:joined', { gameId, game });
      socket.emit('timer:updated', { gameId, timer: game.timer });
      broadcastPresence(gameId);
      return ok(game);
    });

    handle('game:start', socketSchemas.gameOnly, async ({ gameId }) => ok(await gameService.startGame(gameId)));

    handle('rectangle:select', socketSchemas.select, async ({ gameId, rectangleId }) =>
      ok(await gameService.selectRectangle(gameId, rectangleId)));

    handle('rectangle:place', socketSchemas.place, async ({ gameId, ...placement }) => {
      const result = await gameService.placeRectangle(gameId, placement);
      if (result.placement.accepted) return ok(result);
      const { code, message } = result.placement;
      return { success: false, error: { code, message }, data: result };
    });

    handle('game:check', socketSchemas.gameOnly, async ({ gameId }) => {
      const { solved, message, elapsedSeconds, game } = await gameService.checkWin(gameId);
      return { success: true, solved, message, elapsedSeconds, data: game };
    });

    handle('game:reset', socketSchemas.reset, async ({ gameId, ...options }) => ok(await gameService.resetGame(gameId, options)));

    handle('timer:stop', socketSchemas.gameOnly, async ({ gameId }) => {
      const { elapsedSeconds, game } = await gameService.stopTimer(gameId);
      return { success: true, elapsedSeconds, data: game };
    });

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, gameId: socket.data.gameId, reason }, 'Socket disconnected');
      if (socket.data.gameId) broadcastPresence(socket.data.gameId);
    });
  });
}

module.exports = { registerGameSocket, roomOf };

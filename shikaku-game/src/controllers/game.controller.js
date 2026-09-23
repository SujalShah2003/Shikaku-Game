'use strict';

const { sendSuccess, buildErrorBody } = require('../utils/response');
const { ERRORS } = require('../utils/errors');
const {
  validate,
  gameIdParamsSchema,
  createGameSchema,
  resetGameSchema,
  selectRectangleSchema,
  placeRectangleSchema,
} = require('../validators/game.validator');

/** Thin HTTP adapter: validate input → call the game service → shape the response. */
function createGameController(gameService) {
  const gameIdOf = (req) => validate(gameIdParamsSchema, req.params).gameId;

  return {
    async create(req, res) {
      const options = validate(createGameSchema, req.body);
      sendSuccess(res, await gameService.createGame(options), 201);
    },

    async get(req, res) {
      sendSuccess(res, await gameService.getGame(gameIdOf(req)));
    },

    async generate(req, res) {
      sendSuccess(res, await gameService.generatePuzzle(gameIdOf(req)));
    },

    async start(req, res) {
      sendSuccess(res, await gameService.startGame(gameIdOf(req)));
    },

    async select(req, res) {
      const gameId = gameIdOf(req);
      const cell = validate(selectRectangleSchema, req.body);
      sendSuccess(res, await gameService.selectRectangle(gameId, cell));
    },

    async place(req, res) {
      const gameId = gameIdOf(req);
      const body = validate(placeRectangleSchema, req.body);
      const result = await gameService.placeRectangle(gameId, body);
      if (!result.placement.accepted) {
        const { code, message } = result.placement;
        const status = (ERRORS[code] && ERRORS[code][0]) || 422;
        return res.status(status).json(buildErrorBody(code, message, { placement: result.placement, game: result.game }));
      }
      return sendSuccess(res, result);
    },

    async check(req, res) {
      const { solved, message, elapsedSeconds, game } = await gameService.checkWin(gameIdOf(req));
      res.json({ success: true, solved, message, elapsedSeconds, data: game });
    },

    async reset(req, res) {
      const gameId = gameIdOf(req);
      const options = validate(resetGameSchema, req.body);
      sendSuccess(res, await gameService.resetGame(gameId, options));
    },

    async stopTimer(req, res) {
      const { elapsedSeconds, game } = await gameService.stopTimer(gameIdOf(req));
      res.json({ success: true, elapsedSeconds, data: game });
    },
  };
}

module.exports = { createGameController };

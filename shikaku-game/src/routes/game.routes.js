'use strict';

const express = require('express');
const { createGameController } = require('../controllers/game.controller');

function createGameRouter(gameService) {
  const router = express.Router();
  const controller = createGameController(gameService);

  router.post('/', controller.create);
  router.get('/:gameId', controller.get);
  router.post('/:gameId/generate', controller.generate);
  router.post('/:gameId/start', controller.start);
  router.post('/:gameId/rectangles/select', controller.select);
  router.post('/:gameId/rectangles/place', controller.place);
  router.post('/:gameId/check', controller.check);
  router.post('/:gameId/reset', controller.reset);
  router.post('/:gameId/timer/stop', controller.stopTimer);

  return router;
}

module.exports = { createGameRouter };

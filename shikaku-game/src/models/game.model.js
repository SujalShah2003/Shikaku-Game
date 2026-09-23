'use strict';

const mongoose = require('mongoose');
const { DIFFICULTIES, GAME_STATUS, RECTANGLE_STATUS } = require('../config/game.config');

const { Schema } = mongoose;

const clueSchema = new Schema(
  {
    id: { type: String, required: true },
    row: { type: Number, required: true, min: 0 },
    col: { type: Number, required: true, min: 0 },
    value: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const positionSchema = new Schema(
  { row: { type: Number, required: true }, col: { type: Number, required: true } },
  { _id: false },
);

// Server-side only: the rectangle's place in the generated partition.
const solutionSchema = new Schema(
  {
    row: { type: Number, required: true },
    col: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false },
);

const rectangleSchema = new Schema(
  {
    id: { type: String, required: true },
    width: { type: Number, required: true, min: 1 },
    height: { type: Number, required: true, min: 1 },
    area: { type: Number, required: true, min: 1 },
    clueId: { type: String, required: true },
    solution: { type: solutionSchema, required: true },
    currentPosition: { type: positionSchema, default: null },
    status: { type: String, enum: Object.values(RECTANGLE_STATUS), default: RECTANGLE_STATUS.AVAILABLE },
    selected: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
  },
  { _id: false },
);

const gameSchema = new Schema(
  {
    gameId: { type: String, required: true, unique: true, index: true },
    rows: { type: Number, required: true },
    columns: { type: Number, required: true },
    difficulty: { type: String, enum: DIFFICULTIES, required: true },
    status: { type: String, enum: Object.values(GAME_STATUS), default: GAME_STATUS.CREATED },
    clues: { type: [clueSchema], default: [] },
    rectangles: { type: [rectangleSchema], default: [] },
    // Anchor cell of the rectangle currently being drawn.
    selectedRectangle: { type: positionSchema, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    elapsedSeconds: { type: Number, default: 0 },
    moves: { type: Number, default: 0 },
    puzzle: {
      uniqueSolution: { type: Boolean, default: false },
      generationAttempts: { type: Number, default: 0 },
      generatedAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    // Defence in depth: even an accidental res.json(doc) never leaks solutions.
    toJSON: {
      transform(_doc, ret) {
        delete ret._id;
        if (Array.isArray(ret.rectangles)) {
          ret.rectangles.forEach((rect) => {
            delete rect.solution;
            delete rect.clueId;
          });
        }
        return ret;
      },
    },
  },
);

const Game = mongoose.models.Game || mongoose.model('Game', gameSchema);

module.exports = Game;

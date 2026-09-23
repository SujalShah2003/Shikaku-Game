# Shikaku — Real-time Grid Puzzle

A complete, playable **Shikaku** puzzle game built with Node.js, Express, Socket.IO, MongoDB and EJS.
Players split a grid into rectangles by dragging pieces onto the board. Every placement is checked
on the server, games are stored in MongoDB, and any number of browser windows can solve the same
puzzle together in real time.

---

## Features

- **Guaranteed-valid puzzles.** The generator builds a full partition of the board first, then
  derives the clues from it. A backtracking solver then confirms that the clue layout has **exactly one
  solution** before the puzzle is used.
- **Server-authoritative play.** Solutions never leave the server. Every select, place, check, timer
  and reset action is validated and persisted before any client is notified.
- **Real-time multiplayer sync** through Socket.IO rooms (`game:{gameId}`). Share the link, and every
  window sees each move, lock, win and reset instantly. A presence counter shows how many players are viewing.
- **Drag and drop with snap-to-grid.** A live preview turns cyan/✓ for a valid spot and red/striped/✕
  for an invalid one, with a label saying why (for example "✕ 2 numbers" or "✕ Needs 4").
- **Three input styles:** drag, click/tap-to-place, and full keyboard control.
- **Timer** based on `startedAt`/`endedAt` timestamps (no server intervals), with pause and resume.
- Stats (time, rectangles, completion %, moves, difficulty), a progress bar, a completion modal with a
  subtle confetti burst, and toasts.
- **Easy 5×5, Medium 7×7 and Hard 9×9** presets, or custom sizes from 3×3 to 10×10 through the API.
- REST and Socket.IO both call **the same service layer**. If the socket drops, the client falls back to REST.
- Zod validation, a central error catalogue, Pino structured logging, Helmet with CSP, and CORS configured from environment variables.
- A responsive "Modern Neon Puzzle Lab" UI that handles keyboard use, respects reduced-motion settings and uses ARIA labels.
- 73 Jest tests covering the generator, rules, win detection, timer, game service, REST API and Socket.IO sync.

## Tech Stack

| Layer      | Technology                                          |
| ---------- | --------------------------------------------------- |
| Runtime    | Node.js ≥ 20                                        |
| Server     | Express 5, Socket.IO 4                              |
| Database   | MongoDB + Mongoose 9                                |
| Views      | EJS, HTML5, CSS3, vanilla JS (ES modules)           |
| Validation | Zod 4                                               |
| Logging    | Pino + pino-http (pino-pretty in development)       |
| Security   | Helmet (CSP), CORS                                  |
| Tooling    | Nodemon, Jest, Supertest, socket.io-client          |

## Architecture

```text
Browser (EJS page + ES modules)
   │  REST (fetch, relative URLs)        Socket.IO (same origin)
   ▼                                       ▼
routes/game.routes.js               socket/game.socket.js
controllers/game.controller.js        (validate → service → ack)
   │                                       │
   └──────────────┬────────────────────────┘
                  ▼
        services/game.service.js  ── emits domain events ──► socket layer ──► room game:{id}
          ├── puzzle.service.js       (partition generation + uniqueness solver)
          ├── rectangle.service.js    (placement rules, locking, status transitions)
          ├── validation.service.js   (partition checks, win detection, progress)
          └── timer.service.js        (timestamp-based timer)
                  ▼
      repositories/game.repository.js (optimistic concurrency on __v)
                  ▼
          models/game.model.js ──► MongoDB (source of truth)
```

Key decisions:

- **One service, two transports.** Controllers and socket handlers only validate input and shape
  output. After a successful MongoDB write, `game.service` emits a domain event such as
  `rectangle:locked`, and the socket layer relays it to the game room. So a move made over REST
  still reaches every connected socket, and no business logic is duplicated.
- **Optimistic concurrency.** Each write is conditional on the document version (`__v`) that was read.
  On a conflict, the service re-reads and retries. Two players acting at once never overwrite each
  other, and no game state is held in memory.
- **Dependency injection.** `createGameService({ repository, clock, rng })` and `createApp({ gameService })`
  let the tests use an in-memory repository and a controllable clock.
- **Public projection.** `toPublicGame()` is the only shape that leaves the server. It removes
  `solution` and `clueId`, and exposes `currentPosition` only for locked rectangles. As a second
  safeguard, the Mongoose model's `toJSON` also strips them.

## Folder Structure

```text
shikaku-game/
├── src/
│   ├── config/          database.js · env.js · game.config.js
│   ├── controllers/     game.controller.js
│   ├── services/        game · puzzle · rectangle · validation · timer
│   ├── repositories/    game.repository.js      (Mongo persistence boundary)
│   ├── models/          game.model.js
│   ├── routes/          game.routes.js
│   ├── socket/          game.socket.js
│   ├── validators/      game.validator.js       (Zod schemas)
│   ├── middleware/      error · logger · not-found
│   ├── utils/           logger · response · random · errors
│   ├── app.js           Express app factory
│   └── server.js        composition root, Socket.IO, graceful shutdown
├── views/               game.ejs · not-found.ejs · partials/
├── public/
│   ├── css/             main.css · game.css · animations.css
│   ├── js/              game.js · socket.js · drag-drop.js · ui.js
│   └── assets/icons/    logo.svg
├── tests/               unit + integration tests, helpers/
├── Dockerfile · docker-compose.yml · render.yaml
├── .env.example · .gitignore
└── package.json
```

`repositories/` and `utils/errors.js` were added to the requested structure. Keeping the
repository separate from the service is what allows the business logic to be tested without MongoDB.

## Game Rules

The board is a grid of cells, and some cells hold a number. Divide the whole grid into rectangles so that:

1. every rectangle contains **exactly one** number;
2. that number equals the rectangle's **area** (a `4` can be 1×4, 2×2 or 4×1, within the size limits);
3. rectangles never overlap, and together they cover **every** cell.

In this game, the rectangle pieces are provided in the tray, as the assignment specifies. Correctly
placed pieces lock in place. The puzzle is solved when every piece is locked.

## Puzzle Generation Algorithm

`src/services/puzzle.service.js`

1. **Partition.** Scan the cells in row-major order. The first uncovered cell is always the top-left
   corner of a new rectangle, because everything above and to its left is already covered. Collect
   every size `w×h` within `GAME_CONFIG` limits that fits entirely in uncovered cells, and pick one
   using the difficulty's area weights. A 1×1 always fits, so this always terminates. Each cell is
   claimed exactly once, so the result is **non-overlapping and covers the whole board by construction**.
2. **Quality filter.** Reject partitions with too many 1×1 pieces (`singleCellRatio` per difficulty), because they make trivial clues.
3. **Clues.** Put one clue in a random cell of each rectangle, with value = `width × height`.
4. **Uniqueness.** A backtracking solver counts solutions under classic Shikaku rules (it only knows
   the clues). For each clue it lists every rectangle of the right area within the limits that
   contains no other clue. It then repeatedly fills the first uncovered cell, and stops after finding two solutions or
   exceeding a node budget. Only layouts with **exactly one** solution are accepted. Each partition
   gets up to 3 clue layouts, with up to 150 attempts in total. In practice a unique 9×9 puzzle is
   found in about 8 attempts, in under 1 ms. If the budget ever runs out, the last *solvable*
   puzzle is used and flagged `uniqueSolution: false`.
5. **Store and expose.** Each rectangle keeps its `solution` slot on the server. The tray order is
   shuffled so that it reveals nothing about the layout. The client only receives clues and piece sizes.

### Placement validation (`rectangle.service.js`)

Checks run in this order: position on board → `isInsideBoard` → `hasOverlap` with locked rectangles →
exactly one clue (`containsClue`) → `hasCorrectArea` → `isCorrectSolutionPosition`.

Two design decisions (documented per the brief):

- **Identical pieces are interchangeable.** Dropping piece X (2×1) onto the solution slot of
  another unlocked 2×1 piece Y is accepted, and the two pieces swap solution slots. Otherwise,
  players would be told a correct placement is wrong just because they picked the "other" identical piece.
- **Placements are compared to the solution.** Generated puzzles have a unique solution, so a
  placement that fits its clue but is not in that solution can never be completed. Locked pieces
  cannot be moved, so accepting such a placement would leave the puzzle unwinnable. It is rejected
  with a clear message instead.

### State machines

- Game: `created → playing → completed`. Reset moves any state back to `created` with a new puzzle.
  "Paused" means `playing` with the timer stopped.
- Rectangle: `available ⇄ selected`, `available/selected → placed → locked` (valid) or
  `placed → available` (invalid). `locked` is terminal, so for example `locked → selected` is rejected
  with `RECTANGLE_ALREADY_LOCKED`.

### Timer

`elapsedSeconds = floor((endedAt − startedAt) / 1000)`. Nothing runs on an interval on the server.
Pausing sets `endedAt`. Resuming moves `startedAt` forward by the paused duration, so the formula
always gives active play time. The client animates the clock between server snapshots.

## API Documentation

Base path `/api/games`. All responses use one of these two shapes:

```json
{ "success": true, "data": { } }
{ "success": false, "error": { "code": "GAME_NOT_FOUND", "message": "Game not found." } }
```

| Method | Path                                  | Body                                      | Notes |
| ------ | ------------------------------------- | ----------------------------------------- | ----- |
| POST   | `/api/games`                          | `{ difficulty?, rows?, columns? }`        | Creates a game **and** generates its puzzle → `201` |
| GET    | `/api/games/:gameId`                  | –                                         | Public game state (no solutions) |
| POST   | `/api/games/:gameId/generate`         | –                                         | Regenerates the puzzle; only allowed while `created` |
| POST   | `/api/games/:gameId/start`            | –                                         | Starts the timer, or resumes if paused |
| POST   | `/api/games/:gameId/rectangles/select`| `{ rectangleId }`                         | |
| POST   | `/api/games/:gameId/rectangles/place` | `{ rectangleId, row, col }`               | `row`/`col` = top-left cell. Rejected placements → `422` with `error.details.game` |
| POST   | `/api/games/:gameId/check`            | –                                         | `{ success, solved, message, elapsedSeconds, data }` |
| POST   | `/api/games/:gameId/reset`            | `{ difficulty?, rows?, columns? }`        | New puzzle, new IDs, timer, moves and selection cleared |
| POST   | `/api/games/:gameId/timer/stop`       | –                                         | `{ success, elapsedSeconds, data }` (pauses) |
| GET    | `/health`                             | –                                         | `200 {status:"ok"}` or `503` when MongoDB is down |

Example:

```bash
curl -X POST localhost:3000/api/games -H 'Content-Type: application/json' \
     -d '{"rows":5,"columns":5,"difficulty":"easy"}'
```

**Error codes**

| HTTP | Codes |
| ---- | ----- |
| 400  | `VALIDATION_ERROR`, `INVALID_BOARD_SIZE`, `INVALID_DIFFICULTY`, `INVALID_GAME_ID`, `INVALID_RECTANGLE_ID`, `INVALID_POSITION` |
| 404  | `GAME_NOT_FOUND`, `RECTANGLE_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409  | `RECTANGLE_ALREADY_LOCKED`, `GAME_ALREADY_COMPLETED`, `INVALID_GAME_STATE`, `CONCURRENT_UPDATE` |
| 422  | `RECTANGLE_OUT_OF_BOARD`, `RECTANGLE_OVERLAP`, `INVALID_PLACEMENT` |
| 500  | `INTERNAL_ERROR` (details hidden in production) |

## Socket Events

Every client event takes a payload containing `gameId` and an acknowledgement callback. The ack
receives the same `{ success, data | error }` shape as REST.

| Client → Server    | Payload                               |
| ------------------ | ------------------------------------- |
| `game:join`        | `{ gameId }` → joins room `game:{gameId}` |
| `game:start`       | `{ gameId }`                          |
| `rectangle:select` | `{ gameId, rectangleId }`             |
| `rectangle:place`  | `{ gameId, rectangleId, row, col }`   |
| `game:check`       | `{ gameId }`                          |
| `game:reset`       | `{ gameId, difficulty?, rows?, columns? }` |
| `timer:stop`       | `{ gameId }`                          |

| Server → Client      | When |
| -------------------- | ---- |
| `game:joined`        | To the joining socket, with the full public state |
| `game:started`       | Game started or resumed |
| `game:updated`       | After every persisted state change |
| `rectangle:selected` | A piece was selected |
| `rectangle:moved`    | A placement was attempted (`accepted: true/false`, `code`, `message`) |
| `rectangle:locked`   | A placement was accepted and locked |
| `game:reset`         | A new puzzle was generated |
| `game:won`           | Puzzle solved (`elapsedSeconds`, `moves`, `rectangles`) |
| `timer:updated`      | Timer started, stopped, reset or finished |
| `game:error`         | To the requesting socket when an action fails |
| `game:presence`      | Number of sockets in the room (extra) |

Every state payload includes a `version`. Clients ignore snapshots older than the one they already
have, so events arriving out of order cannot roll the board back.

## Database Model

`games` collection (see `src/models/game.model.js`):

```js
{
  gameId, rows, columns, difficulty, status, moves,
  clues: [{ id, row, col, value }],
  rectangles: [{
    id, width, height, area,
    clueId,                                  // server-only
    solution: { row, col, width, height },   // server-only
    currentPosition: { row, col } | null,
    status, selected, locked
  }],
  selectedRectangle, startedAt, endedAt, elapsedSeconds,
  puzzle: { uniqueSolution, generationAttempts, generatedAt },
  createdAt, updatedAt, __v                  // __v = optimistic-concurrency version
}
```

## Environment Setup

```bash
cp .env.example .env
```

| Variable      | Default                              | Description |
| ------------- | ------------------------------------ | ----------- |
| `PORT`        | `3000`                               | HTTP port (Render sets it automatically) |
| `MONGODB_URI` | `mongodb://localhost:27017/shikaku`  | MongoDB connection string |
| `NODE_ENV`    | `development`                        | `development`, `production` or `test` |
| `CLIENT_URL`  | *(empty)*                            | Comma-separated extra origins allowed by CORS/Socket.IO. Same-origin always works. |
| `LOG_LEVEL`   | `info` (`silent` in tests)           | Pino log level |

Secrets are never logged. Invalid environment variables are reported by name only.

## MongoDB Setup

Pick one:

- **Docker (recommended):** `docker compose up -d mongo`
- **Local install:** install MongoDB Community and run `mongod`. The default URI works as is.
- **MongoDB Atlas:** create a free cluster and set `MONGODB_URI` to its connection string.

## Running Locally

```bash
npm install

npm run dev
```

Open <http://localhost:3000>. A new game is created and its ID is added to the URL
(`?game=<id>`). Click **Share** and open the link in a second window to see real-time sync.

Other scripts:

```bash
npm start              # node src/server.js
npm run start:prod     # NODE_ENV=production node src/server.js
docker compose up --build   # MongoDB + app, on http://localhost:3000
```

## Testing

```bash
npm test
```

`npm run test:watch` and `npm run test:coverage` are also available. The suites are:

| Suite                         | Covers |
| ----------------------------- | ------ |
| `puzzle.service.test.js`      | full coverage, no overlaps, inside the board, valid dimensions, exactly one clue per rectangle, clue = area, unique solution, solver edge cases (168 generated puzzles) |
| `rectangle.service.test.js`   | valid/invalid/out-of-board/overlapping placements, locked pieces can't move, swapping identical pieces, state transitions |
| `validation.service.test.js`  | unsolved when incomplete, unsolved when a piece is misplaced, solved when correct, partition analysis |
| `timer.service.test.js`       | timestamps, freezing on stop, excluding paused time, reset |
| `game.service.test.js`        | creation, limits, no solution leak, select/place/lock, completion + `game:won`, timer, reset, concurrent placements |
| `api.test.js`                 | every REST endpoint, error format, status codes, health, page rendering |
| `socket.test.js`              | two clients kept in sync, REST → socket broadcast, `game:error`, rejected placements, `game:won` |

The service and API tests use an in-memory repository with the same optimistic-concurrency
contract as MongoDB, so `npm test` does not need a database.

## Deployment (Render)

This is one Node web service: the same process serves the EJS page, the REST API and Socket.IO.

1. Create a MongoDB Atlas cluster, and allow access from Render's IPs (or `0.0.0.0/0`).
2. On Render, create a **Web Service** from the repo, or use the included `render.yaml` Blueprint.
   - Build command: `npm ci --omit=dev`, start command: `npm start`, health check: `/health`
3. Set the environment variables `NODE_ENV=production`, `MONGODB_URI=<atlas uri>` and
   `CLIENT_URL=https://<service>.onrender.com`.

Notes: the client uses relative URLs, and Socket.IO connects to the page's own origin, so
nothing is hard-coded to localhost. In production `trust proxy` is enabled. On `SIGTERM`, the server
stops accepting connections, closes Socket.IO and HTTP, and disconnects MongoDB. A 10 s timeout
forces the exit if that stalls. At startup, the MongoDB connection is retried 5 times with backoff
before the process exits.

## Screenshots

_Add screenshots here:_

- `docs/screenshots/board.png`: game in progress
- `docs/screenshots/preview.png`: invalid snap preview
- `docs/screenshots/win.png`: completion modal
- `docs/screenshots/mobile.png`: mobile layout

## Known Limitations

- No accounts. Anyone with the game link can play, and the game ID acts as the access token.
- Pieces cannot be rotated. The tray shows each piece in the orientation it has in the solution.
- A locked piece is final, as the brief requires, so there is no undo.
- Selection is shared between players, and there is no per-player cursor or ownership.
- The client animates the timer between server snapshots, so on a very slow connection the display can lag by up to a second.
- Old games are never deleted (no TTL index).

## Future Improvements

- Piece rotation, and a "pencil" mode for unlocked, tentative placements
- Hints powered by the existing solver
- Leaderboards and personal best times per difficulty
- Player names, cursors and per-player colours in shared rooms
- A TTL index or cron job to expire abandoned games
- The Socket.IO Redis adapter for horizontal scaling across several instances

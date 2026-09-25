# Shikaku Game

A real-time, multiplayer **Shikaku** puzzle game built with Node.js, Express, Socket.IO, MongoDB and EJS.
Players split a grid into rectangles so that each one contains exactly one number equal to its area.
Several browser windows can solve the same puzzle together, and every move is checked on the server.

The application lives in [`shikaku-game/`](shikaku-game/). For the full documentation (architecture,
puzzle generation algorithm, REST API, Socket.IO events and database model), see
[shikaku-game/README.md](shikaku-game/README.md).

## Repository Layout

```text
.
├── README.md            this file
└── shikaku-game/        the application
    ├── src/             server: config, routes, controllers, services, socket, models
    ├── views/           EJS templates
    ├── public/          client CSS, JavaScript and assets
    ├── tests/           Jest unit and integration tests
    ├── Dockerfile · docker-compose.yml · render.yaml
    └── package.json
```

## Quick Start

Requirements: Node.js 20 or later, and MongoDB (local, Docker or Atlas).

```bash
cd shikaku-game
cp .env.example .env        # then set MONGODB_URI
docker compose up -d mongo  # optional: start a local MongoDB
npm install
npm run dev
```

Open <http://localhost:3000> (or the `PORT` set in `.env`). Click **Share** and open the link in a
second window to see real-time sync.

To run the app and MongoDB together in Docker:

```bash
cd shikaku-game
docker compose up --build
```

## Tests

```bash
cd shikaku-game
npm test
```

The tests use an in-memory repository, so they don't need a database.

## Deployment

The app deploys to Render as a single web service using
[`shikaku-game/render.yaml`](shikaku-game/render.yaml). Because the app is in a subfolder, set the
service's **Root Directory** to `shikaku-game`. See the
[deployment section](shikaku-game/README.md#deployment-render) of the app README for the rest of the setup.

## Tech Stack

Node.js · Express 5 · Socket.IO 4 · MongoDB + Mongoose 9 · EJS · Zod · Pino · Jest

## License

MIT

# TREASURE RUSH — The Last Treasure Wins

A browser-based, turn-based treasure hunt for 2–8 players. Create a room, share its five-character code, and play together on a server-generated map. No accounts or installation in the browser are required.

## Features
- Live rooms, lobby, host start, reconnect, host transfer, replay, and room codes.
- One authoritative 10×10 board shared by all room members.
- Validated movement, 15-second turns, live scores/leaderboard, and visible power-ups.
- Gold, diamonds, crowns, risk chests, traps, mystery events, shields, double points, teleport, and Quick Draw.
- Equal-turn final round, score/tiebreak winner calculation, and shared victories.
- Responsive touch D-pad, accessible controls, rules guide, reduced-motion support, optional generated sound.

## Game Rules
Players move one orthogonal tile per turn. Gold is +10, a diamond +25, a crown +40. A trap is −20 unless a shield blocks it. A mystery tile resolves one server-selected event. Chests offer a guaranteed +15 or a 70% chance of +50 and a 30% chance of −30. A shield blocks one trap; double points multiplies the next treasure. A Quick Draw winner gains 20 and the opponent loses 10. Scores never drop below zero.

Reaching 100 points triggers the final round rather than ending immediately. Each player completes the same number of turns; the highest score wins. Ties are broken by treasures collected, then rare treasures (diamonds, crowns, and chests), otherwise victory is shared.

## Requirements
- Node.js 20 LTS or newer.
- npm 10 or newer.
- A modern browser. For online play, players need a network route to the same deployed server.

## Local Setup
Run these commands from the repository root:

```powershell
npm install
npm run dev
```

Open the Vite URL printed in the terminal, normally `http://localhost:5179/`. The game server listens on `http://localhost:4000/`. The Vite dev server proxies Socket.IO traffic to it. Keep the terminal running while playing.

To play on one computer with two sessions, open the Vite URL in two separate browser windows or profiles. Create a room in one, join its code in the other, then start from the host session.

## Commands
- `npm run dev` — start the game server and Vite client together.
- `npm test` — run server rules and two-client Socket.IO integration tests.
- `npm run build` — build the production frontend.
- `npm start` — serve production assets and Socket.IO from the same Node server (run `npm run build` first).
- `npm run check` — run tests and production build.
- `GET /health` — basic server health endpoint.

There is no separate type-check or lint configuration in this JavaScript project. Use `npm run check` for the configured validation gates.

## Technology and Multiplayer
- React 18 and Vite 6 for the browser client.
- Node.js, Express, and Socket.IO 4 for multiplayer.
- Node's built-in test runner for game logic and transport integration.

The browser sends intent only: create/join, direction, chest choice, or Quick Draw tap. The server identifies the player from their socket, validates the room/phase/turn, generates the board and random results, applies scoring, owns timers, and broadcasts complete room snapshots. Client-provided score, position, turn, and random values are never accepted. A short-lived resume token stored in that browser's local storage restores a disconnected player when they reconnect.

## Environment Variables
- `PORT` — optional HTTP port for the Node server; defaults to `4000`. Hosts commonly set this automatically.
- `VITE_SERVER_URL` — optional frontend build-time Socket.IO server URL. Leave unset for same-origin hosting; set it to the Render backend URL when the frontend is hosted separately on Netlify.

No API keys or third-party service credentials are needed.

## Production Build and Deployment
Build and run locally:

```powershell
npm run build
npm start
```

Deploy the repository as a **single Node.js web service** on a host that supports long-lived WebSocket connections (for example, Render or Railway):

1. Connect the Git repository and select Node.js.
2. Set the build command to `npm ci && npm run build`.
3. Set the start command to `npm start`.
4. Set `PORT` only if the platform does not provide it automatically.
5. Enable WebSocket support and use one backend instance for each in-memory room set.
6. Open the public service URL supplied by the host; frontend and Socket.IO share that origin.

The project also supports hosting only the frontend on Netlify while keeping the backend on Render:

1. Import `sravani1002/Tressure_Hunt` into Netlify and deploy the `main` branch.
2. Use the repository root as the base directory, `npm ci && npm run build` as the build command, and `frontend/dist` as the publish directory. These settings are included in `netlify.toml`.
3. In Netlify site settings, add `VITE_SERVER_URL` with the value `https://tressure-hunt-85vf.onrender.com`, then trigger a new deploy so Vite embeds the backend URL in the frontend bundle.
4. Share the Netlify site URL. The frontend connects directly to the Render Socket.IO service; Render remains responsible for rooms, timers, and game state.

The single-service Render deployment remains the simplest option. Netlify hosting is optional and does not replace the backend.

## Limitations
Room/game state is in memory. Restarting the service clears active rooms, and multiple backend replicas do not share room state. Use one persistent Node process for a small public deployment; a shared store/adapter and room persistence are needed before horizontal scaling. Reconnection works only while the room remains in memory and uses the same browser's local storage. The final-round rule uses the turn counts at the moment the 100-point threshold is reached, then gives the remaining players the turns needed to equalize the round.

## Project Structure
```text
backend/src/game.js          Authoritative rooms, turns, scoring, tile effects
backend/src/server.js        Express, Socket.IO events, production static serving
backend/test/game.test.js    Rules, validation, disconnect, and replay tests
backend/test/server.test.js  Two-client multiplayer flow test
frontend/src/main.jsx        Home, lobby, board, decisions, leaderboard, results
frontend/src/styles.css      Responsive UI and motion/accessibility styles
frontend/vite.config.js      Vite setup and Socket.IO development proxy
netlify.toml                 Netlify frontend build and publish settings
PLAN.md                      Architecture and implementation plan
ARCHITECTURE.md              State model and synchronization decisions
FINAL_CHECKLIST.md           Verified completion checklist
```
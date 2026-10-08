# Treasure Rush Implementation Plan

## Architecture
Use a React and Vite browser client with a Node.js Express and Socket.IO server. The browser sends intent-only actions; the server validates them and broadcasts the complete room snapshot. Development uses Vite's proxy, while production serves the built frontend from the same Node.js service.

## Technology Stack
- React for the responsive game interface.
- Vite for local development and production assets.
- Express and Socket.IO for the multiplayer server and transport.
- Node's built-in test runner for server game rules.

## Folder Structure
- `frontend/src/main.jsx`: client views and socket-driven interactions.
- `frontend/src/styles.css`: responsive visual system.
- `backend/src/game.js`: authoritative room/game rules.
- `backend/src/server.js`: HTTP and Socket.IO event boundary.
- `backend/test/game.test.js`: game and room rule tests.

## Multiplayer Approach
Rooms live in server memory and are keyed by short room codes. A player's socket is associated with one room/player identity. The server creates the board once, owns all random outcomes and timers, validates each intent, and emits snapshots to every room member. Disconnects preserve player identity for a short reconnect window; the active timer continues and the host transfers to a connected player.

## Data/State Model
Each room contains its code, host player ID, phase, server-generated board, player records, turn index, turn deadline, optional pending chest/challenge, final-round boundary, event message, and winner IDs. Players contain stable IDs, display name, avatar/color, position, score, treasure/tiebreak counts, shield/double status, and connection state.

## Game State Machine
`LOBBY -> PLAYING -> FINAL_ROUND -> GAME_OVER`; challenge and chest decisions are blocking sub-states attached to the current turn. Only the host can start/replay. Only the current connected player can move or answer their pending decision. Each turn expires after 15 seconds. Reaching 100 points marks the round boundary; the game ends once each player has completed the same number of turns at or beyond that boundary.

## Testing Strategy
Use deterministic injectable randomness/time where practical and Node's built-in test runner for room validation, movement, turn enforcement, tile effects, decision actions, timeout progression, disconnects, final scoring, and replay. Run frontend production build and use two independent browser sessions against the same server to verify synchronization when browser automation is available.

## Deployment Strategy
Build the frontend with `npm run build`; run the root Node server with `npm start`, which serves the built assets and Socket.IO on the same origin. Deploy the repository to a Node host that supports persistent WebSocket connections and set `PORT` if required by the platform. Room state is intentionally in memory, so multiple backend replicas and persistence across restarts are not supported without adding a shared state service.
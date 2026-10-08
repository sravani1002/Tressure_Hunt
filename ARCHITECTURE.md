# Architecture Decisions

## Runtime Layout
The React/Vite client connects to one Node process running Express and Socket.IO. In development, Vite serves `frontend/` on port 5179 and proxies `/socket.io` to port 4000. In production, Express serves `frontend/dist` and Socket.IO on the same origin. The server exposes `/health` for deployment checks.

```text
Browser A ─┐                         ┌─ authoritative room state
           ├─ Socket.IO intents ────►│  room / turn / board / timers
Browser B ─┘◄── room snapshots ──────┘
```

## Authority and Trust
`backend/src/game.js` owns room membership, player identities, board generation, movement validation, tile effects, randomness, score changes, timers, final-round progression, and winners. The socket layer maps the active socket to its player; event payload player IDs are not trusted. Clients submit only intent. All room members receive the same serialized snapshot after state changes.

The server emits snapshots on room mutations and game actions, not every countdown second. Each snapshot contains a server deadline; clients render a local countdown from that deadline. This keeps network traffic low while retaining one shared turn deadline.

## Room and Player State
- Room: short code, host ID, phase, player list, board, turn order/current player/deadline, pending chest, optional Quick Draw, final-round boundary, winner IDs, last event, revision.
- Player: random stable ID, normalized unique display name, color, position, score, treasure/tiebreak counts, shield and double-points flags, connected state, host flag, socket ID, resume token, turns taken.
- Board: server-generated 10×10 array; special locations remain hidden until revealed. Collected tiles are consumed on the server.

Public snapshots omit socket IDs and resume tokens. Reconnect requires the matching resume token and room code; the server reattaches the existing record rather than creating a duplicate.

## Event Protocol
- `room:create`, `room:join`, `room:reconnect`, `room:leave`, `room:start`, `room:replay`
- `game:move`, `game:chest`, `game:quick-draw`
- `room:update` broadcasts the full public state.

Every command receives an acknowledgement with `{ ok, error?, ... }`. Invalid membership, room state, host rights, turn ownership, directions, choices, and challenge timing are rejected by the server.

## State Machine
- `LOBBY`: join/leave; host can start with at least two connected players.
- `PLAYING`: current player can move; turn deadline is 15 seconds.
- `CHEST_DECISION`: the active player chooses safe/risky; timeout automatically chooses safe.
- `CHALLENGE`: selected participants get a synchronized ready/go window; first valid tap wins, no response gives no score change, and participant disconnect cancels.
- `FINAL_ROUND`: entered after the threshold is reached and the triggering turn is counted; continue until every player has reached that round's equal-turn boundary.
- `GAME_OVER`: final ranking and winner IDs are fixed; host may replay.

Disconnect marks the player away, transfers host to the next connected player, and leaves the turn deadline running. Disconnect during Quick Draw cancels that duel safely. A deliberate leave removes lobby/game-over players; during a live game it follows disconnect behavior.

## Test Strategy
The Node test runner covers room/name/cap validation, host start, movement and turn authority, board/treasure/trap/power-up/mystery/chest/teleport/Quick Draw outcomes, timeout, disconnect/reconnect/host transfer, final-round/tie-break outcomes, leave, and replay. The Socket.IO integration test connects two actual clients to a local server and verifies synchronized lobby, board, movement, final round, winner, and replay state. `npm run build` checks the production frontend bundle.

## Deployment and Scale
The intended deployment is one Node web service with built static assets and WebSockets. `PORT` is the only runtime environment setting. In-memory rooms are simple and deterministic for a small game deployment but are lost on process restart and cannot be shared by multiple replicas. Add shared persistence and a Socket.IO adapter before scaling horizontally.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameManager, BOARD_SIZE, MAX_PLAYERS } = require('../src/game');

function setup(random = () => 0) {
  let playerNumber = 0;
  let currentTime = 1000;
  let taskNumber = 0;
  const tasks = new Map();
  const manager = createGameManager({
    random,
    now: () => currentTime,
    codeFactory: () => 'TR7K2',
    playerIdFactory: () => `player-${++playerNumber}`,
    schedule: (callback, delay) => {
      const id = ++taskNumber;
      tasks.set(id, { callback, delay, active: true });
      return id;
    },
    cancel: (id) => { if (tasks.has(id)) tasks.get(id).active = false; },
  });
  const host = manager.createRoom('socket-1', 'Alex');
  const guest = manager.joinRoom('socket-2', host.code, 'Mina');
  const runDelay = (delay) => {
    const task = [...tasks.values()].find((item) => item.active && item.delay === delay);
    assert.ok(task, `expected active ${delay}ms timer`);
    task.active = false;
    currentTime += delay;
    task.callback();
  };
  const setTile = (room, x, y, type) => {
    const tile = room.board[y * BOARD_SIZE + x];
    Object.assign(tile, { type, active: true, revealed: false });
  };
  const start = () => manager.startRoom(host.code, host.playerId);
  return { manager, host, guest, tasks, runDelay, setTile, start, now: () => currentTime, dispose: () => manager.dispose() };
}

test('creates rooms and validates codes, names, duplicate names, and player cap', () => {
  const game = setup();
  assert.equal(game.host.ok, true);
  assert.equal(game.host.code, 'TR7K2');
  assert.equal(game.manager.joinRoom('x', 'xx?xx', 'Other').error, 'Please enter a valid 5-character room code.');
  assert.equal(game.manager.joinRoom('x', 'NOPE1', 'Other').error, 'Room not found.');
  assert.match(game.manager.joinRoom('x', 'TR7K2', ' alex ').error, /already taken/);
  assert.match(game.manager.joinRoom('x', 'TR7K2', '   ').error, /Enter a name/);
  for (let count = 2; count < MAX_PLAYERS; count += 1) assert.equal(game.manager.joinRoom(`s${count}`, 'TR7K2', `Guest ${count}`).ok, true);
  assert.equal(game.manager.joinRoom('overflow', 'TR7K2', 'Overflow').error, 'This room is full.');
  game.dispose();
});

test('requires host and two connected players to start, then uses one shared board', () => {
  const game = setup();
  let soloId = 0;
  const soloManager = createGameManager({ codeFactory: () => 'SOLO1', playerIdFactory: () => `solo-${++soloId}` });
  const solo = soloManager.createRoom('solo', 'Solo');
  assert.match(soloManager.startRoom(solo.code, solo.playerId).error, /At least 2/);
  soloManager.dispose();
  assert.match(game.manager.startRoom(game.host.code, game.guest.playerId).error, /Only the host/);
  assert.equal(game.start().ok, true);
  assert.equal(game.manager.getRoom(game.host.code).board.length, 100);
  assert.equal(game.manager.getRoom(game.host.code).board[0].type, 'empty');
  game.dispose();
});

test('validates direction, bounds, and turn ownership; collects a gold tile once', () => {
  const game = setup();
  game.start();
  const room = game.manager.rooms.get(game.host.code);
  game.setTile(room, 1, 0, 'gold');
  assert.match(game.manager.move(game.host.code, game.host.playerId, 'left').error, /outside/);
  assert.match(game.manager.move(game.host.code, game.host.playerId, 'diagonal').error, /up, down/);
  assert.equal(game.manager.move(game.host.code, game.host.playerId, 'right').ok, true);
  assert.equal(game.manager.getRoom(game.host.code).players[0].score, 10);
  assert.equal(game.manager.getRoom(game.host.code).board[1].type, 'empty');
  assert.match(game.manager.move(game.host.code, game.host.playerId, 'right').error, /Wait for your turn/);
  assert.equal(game.manager.getRoom(game.host.code).currentPlayerId, game.guest.playerId);
  game.dispose();
});

test('applies diamond, crown, chest choice, shields, and double points authoritatively', () => {
  const game = setup();
  game.start();
  const room = game.manager.rooms.get(game.host.code);
  const player = room.players[0];
  player.doublePoints = true;
  game.setTile(room, 1, 0, 'diamond');
  game.manager.move(game.host.code, player.id, 'right');
  assert.equal(player.score, 50);
  assert.equal(player.rareTreasures, 1);
  player.position = { x: 0, y: 0 };
  room.currentPlayerId = player.id;
  game.setTile(room, 0, 1, 'crown');
  game.manager.move(game.host.code, player.id, 'down');
  assert.equal(player.score, 90);
  player.position = { x: 0, y: 0 };
  room.currentPlayerId = player.id;
  player.shield = true;
  game.setTile(room, 0, 1, 'trap');
  game.manager.move(game.host.code, player.id, 'down');
  assert.equal(player.score, 90);
  assert.equal(player.shield, false);
  room.currentPlayerId = player.id;
  player.position = { x: 0, y: 0 };
  game.setTile(room, 0, 1, 'chest');
  game.manager.move(game.host.code, player.id, 'down');
  assert.equal(room.phase, 'CHEST_DECISION');
  assert.equal(game.manager.chooseChest(game.host.code, game.guest.playerId, 'risky').ok, false);
  assert.equal(game.manager.chooseChest(game.host.code, player.id, 'safe').ok, true);
  assert.equal(player.score, 105);
  game.dispose();
});

test('resolves mystery outcomes and teleports to an unoccupied valid tile', () => {
  const game = setup();
  game.start();
  const room = game.manager.rooms.get(game.host.code);
  game.setTile(room, 1, 0, 'mystery');
  game.manager.move(game.host.code, game.host.playerId, 'right');
  assert.equal(room.players[0].score, 20);
  assert.equal(room.board[1].active, false);
  room.currentPlayerId = game.host.playerId;
  room.players[0].position = { x: 0, y: 0 };
  game.setTile(room, 1, 0, 'teleport');
  game.manager.move(game.host.code, game.host.playerId, 'right');
  assert.notDeepEqual(room.players[0].position, { x: 1, y: 0 });
  assert.ok(room.players[0].position.x >= 0 && room.players[0].position.x < BOARD_SIZE);
  assert.ok(room.players[0].position.y >= 0 && room.players[0].position.y < BOARD_SIZE);
  game.dispose();
});

test('turn timeout skips the active player and advances the shared turn', () => {
  const game = setup();
  game.start();
  game.runDelay(15_000);
  const room = game.manager.getRoom(game.host.code);
  assert.equal(room.currentPlayerId, game.guest.playerId);
  assert.equal(room.players[0].turnsTaken, 1);
  assert.equal(room.timeRemaining, 15);
  game.dispose();
});

test('Quick Draw blocks early/outsider actions, scores once, and cancels on disconnect', () => {
  const game = setup();
  game.start();
  const room = game.manager.rooms.get(game.host.code);
  game.setTile(room, 1, 0, 'challenge');
  game.manager.move(game.host.code, game.host.playerId, 'right');
  assert.equal(room.phase, 'CHALLENGE');
  assert.match(game.manager.quickDraw(game.host.code, game.host.playerId).error, /Wait for GO/);
  game.runDelay(2000);
  assert.equal(game.manager.quickDraw(game.host.code, game.guest.playerId).ok, true);
  assert.equal(room.players[1].score, 20);
  assert.equal(room.players[0].score, 0);
  assert.equal(game.manager.quickDraw(game.host.code, game.guest.playerId).ok, false);
  game.dispose();

  const second = setup();
  second.start();
  const secondRoom = second.manager.rooms.get(second.host.code);
  second.setTile(secondRoom, 1, 0, 'challenge');
  second.manager.move(second.host.code, second.host.playerId, 'right');
  second.manager.disconnect('socket-2');
  assert.equal(secondRoom.challenge, null);
  assert.equal(secondRoom.phase, 'PLAYING');
  second.dispose();
});

test('Quick Draw timeout ends without changing scores and advances the turn', () => {
  const game = setup();
  game.start();
  const room = game.manager.rooms.get(game.host.code);
  game.setTile(room, 1, 0, 'challenge');
  game.manager.move(game.host.code, game.host.playerId, 'right');
  game.runDelay(2000);
  game.runDelay(8000);
  assert.equal(room.phase, 'PLAYING');
  assert.equal(room.players[0].score, 0);
  assert.equal(room.players[1].score, 0);
  assert.equal(room.currentPlayerId, game.guest.playerId);
  game.dispose();
});

test('risky chest win and loss are selected by server randomness', () => {
  for (const [random, expectedScore] of [[() => 0, 50], [() => 0.9, 0]]) {
    const game = setup(random);
    game.start();
    const room = game.manager.rooms.get(game.host.code);
    game.setTile(room, 1, 0, 'chest');
    game.manager.move(game.host.code, game.host.playerId, 'right');
    assert.equal(game.manager.chooseChest(game.host.code, game.host.playerId, 'risky').ok, true);
    assert.equal(room.players[0].score, expectedScore);
    game.dispose();
  }
});

test('host transfers on disconnect and the player can reconnect without duplication', () => {
  const game = setup();
  game.manager.disconnect('socket-1');
  const room = game.manager.rooms.get(game.host.code);
  assert.equal(room.hostId, game.guest.playerId);
  assert.equal(game.manager.reconnect('socket-1b', game.host.code, game.host.resumeToken).ok, true);
  assert.equal(room.players.length, 2);
  assert.equal(room.players[0].connected, true);
  game.dispose();
});

test('leaving in the lobby transfers host and deletes an empty room', () => {
  const game = setup();
  assert.equal(game.manager.leave('socket-1', game.host.code).ok, true);
  const room = game.manager.rooms.get(game.host.code);
  assert.equal(room.hostId, game.guest.playerId);
  assert.equal(room.players.length, 1);
  assert.equal(game.manager.leave('socket-2', game.host.code).ok, true);
  assert.equal(game.manager.getRoom(game.host.code), null);
  game.dispose();
});

test('final round gives the trailing player a turn and selects by score and treasure tiebreaks', () => {
  const game = setup();
  game.start();
  const room = game.manager.rooms.get(game.host.code);
  room.players[0].score = 95;
  game.setTile(room, 1, 0, 'gold');
  game.manager.move(game.host.code, game.host.playerId, 'right');
  assert.equal(room.phase, 'FINAL_ROUND');
  assert.equal(room.phase === 'GAME_OVER', false);
  assert.equal(game.manager.move(game.host.code, game.guest.playerId, 'right').ok, true);
  assert.equal(room.phase, 'GAME_OVER');
  assert.deepEqual(room.winnerIds, [game.host.playerId]);
  game.dispose();
});

test('winner ties break first by treasure count, then rare treasure count', () => {
  for (const [guestTreasures, guestRareTreasures] of [[3, 0], [2, 1]]) {
    const game = setup();
    game.start();
    const room = game.manager.rooms.get(game.host.code);
    room.players[0].score = 95;
    room.players[1].score = 105;
    room.players[1].treasures = guestTreasures;
    room.players[1].rareTreasures = guestRareTreasures;
    game.setTile(room, 1, 0, 'gold');
    game.manager.move(game.host.code, game.host.playerId, 'right');
    game.setTile(room, 1, 0, 'empty');
    room.board[1].active = false;
    assert.equal(game.manager.move(game.host.code, game.guest.playerId, 'right').ok, true);
    assert.deepEqual(room.winnerIds, [game.guest.playerId]);
    game.dispose();
  }
});

test('replay resets scores and starts a fresh synchronized game; room rejects joins after start', () => {
  const game = setup();
  game.start();
  assert.match(game.manager.joinRoom('third', game.host.code, 'Third').error, /already started/);
  const room = game.manager.rooms.get(game.host.code);
  room.phase = 'GAME_OVER';
  room.winnerIds = [game.host.playerId];
  assert.equal(game.manager.replay(game.host.code, game.guest.playerId).error, 'Only the host can start a replay.');
  assert.equal(game.manager.replay(game.host.code, game.host.playerId).ok, true);
  assert.equal(game.manager.getRoom(game.host.code).phase, 'PLAYING');
  assert.equal(game.manager.getRoom(game.host.code).players.every((player) => player.score === 0), true);
  game.dispose();
});
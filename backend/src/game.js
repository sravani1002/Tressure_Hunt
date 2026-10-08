const { randomBytes, randomUUID } = require('node:crypto');

const BOARD_SIZE = 10;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const TURN_MS = 15_000;
const TARGET_SCORE = 100;
const PLAYER_COLORS = ['#e56b45', '#297c73', '#d5a33c', '#6577be', '#a35b83', '#5d8d47', '#bb7042', '#4c809c'];
const TREASURE_VALUES = { gold: 10, diamond: 25, crown: 40 };
const TILE_COUNTS = { gold: 18, diamond: 8, crown: 4, chest: 4, trap: 12, mystery: 10, shield: 6, teleport: 4, double: 6, challenge: 5 };
const DIRECTIONS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function result(ok, error, data = {}) {
  return { ok, ...(error ? { error } : {}), ...data };
}

function makeBoard(random) {
  const board = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, id) => ({ id, type: 'empty', revealed: true, active: false }));
  const pool = [];
  for (const [type, count] of Object.entries(TILE_COUNTS)) {
    for (let index = 0; index < count; index += 1) pool.push(type);
  }
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  const available = board.filter((tile) => tile.id !== 0);
  for (let index = 0; index < pool.length; index += 1) {
    const tile = available[index];
    tile.type = pool[index];
    tile.revealed = false;
    tile.active = true;
  }
  return board;
}

function publicPlayer(player, currentPlayerId) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    position: { ...player.position },
    score: player.score,
    treasures: player.treasures,
    rareTreasures: player.rareTreasures,
    shield: player.shield,
    doublePoints: player.doublePoints,
    connected: player.connected,
    isHost: player.isHost,
    isTurn: player.id === currentPlayerId,
    turnsTaken: player.turnsTaken,
  };
}

function publicRoom(room, now = Date.now()) {
  const current = room.players.find((player) => player.id === room.currentPlayerId);
  const board = room.board.map((tile) => ({
    id: tile.id,
    type: tile.revealed || !tile.active ? tile.type : 'hidden',
    revealed: tile.revealed,
    active: tile.active,
  }));
  const ranked = room.players.map((player) => publicPlayer(player, room.currentPlayerId))
    .sort((a, b) => b.score - a.score || b.treasures - a.treasures || a.name.localeCompare(b.name));
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: room.players.map((player) => publicPlayer(player, room.currentPlayerId)),
    leaderboard: ranked,
    board,
    currentPlayerId: room.currentPlayerId,
    turnEndsAt: room.turnEndsAt,
    timeRemaining: room.turnEndsAt ? Math.max(0, Math.ceil((room.turnEndsAt - now) / 1000)) : 0,
    pendingChest: room.pendingChest ? { playerId: room.pendingChest.playerId } : null,
    challenge: room.challenge ? {
      challengerId: room.challenge.challengerId,
      opponentId: room.challenge.opponentId,
      stage: room.challenge.stage,
      goAt: room.challenge.goAt,
      endsAt: room.challenge.endsAt,
      winnerId: room.challenge.winnerId,
    } : null,
    finalRoundTarget: room.finalRoundTarget,
    winnerIds: [...room.winnerIds],
    event: room.event,
    revision: room.revision,
  };
}

function createGameManager(options = {}) {
  const rooms = new Map();
  const random = options.random || Math.random;
  const now = options.now || Date.now;
  const schedule = options.schedule || setTimeout;
  const cancel = options.cancel || clearTimeout;
  const timers = new Map();
  const codeFactory = options.codeFactory || (() => randomBytes(4).toString('hex').slice(0, 5).toUpperCase());
  const playerIdFactory = options.playerIdFactory || randomUUID;

  function roomFor(code) {
    return rooms.get(String(code || '').trim().toUpperCase());
  }

  function touch(room) {
    room.revision += 1;
  }

  function stopTimer(code, name) {
    const roomTimers = timers.get(code);
    if (!roomTimers?.[name]) return;
    cancel(roomTimers[name]);
    delete roomTimers[name];
  }

  function setTimer(room, name, delay, callback) {
    stopTimer(room.code, name);
    const roomTimers = timers.get(room.code) || {};
    roomTimers[name] = schedule(() => {
      delete roomTimers[name];
      callback();
    }, Math.max(0, delay));
    timers.set(room.code, roomTimers);
  }

  function emitChange(room) {
    touch(room);
    options.onChange?.(room.code, publicRoom(room, now()));
  }

  function findPlayer(room, playerId) {
    return room.players.find((player) => player.id === playerId);
  }

  function validateName(room, input, allowExistingId) {
    const name = cleanName(input);
    if (!name || name.length > 18 || /[\u0000-\u001f\u007f]/.test(name)) return { error: 'Enter a name from 1 to 18 characters.' };
    const duplicate = room?.players.some((player) => player.id !== allowExistingId && player.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) return { error: 'That name is already taken.' };
    return { name };
  }

  function newPlayer(room, name, socketId) {
    const player = {
      id: playerIdFactory(),
      name,
      color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
      position: { x: 0, y: 0 },
      score: 0,
      treasures: 0,
      rareTreasures: 0,
      shield: false,
      doublePoints: false,
      connected: true,
      isHost: false,
      socketId,
      resumeToken: randomBytes(24).toString('base64url'),
      turnsTaken: 0,
    };
    room.players.push(player);
    return player;
  }

  function createRoom(socketId, inputName) {
    const checked = validateName(null, inputName);
    if (checked.error) return result(false, checked.error);
    let code = codeFactory();
    let attempts = 0;
    while (rooms.has(code) && attempts < 20) {
      code = codeFactory();
      attempts += 1;
    }
    if (rooms.has(code)) return result(false, 'Could not create a room. Please try again.');
    const room = {
      code,
      hostId: null,
      phase: 'LOBBY',
      players: [],
      board: [],
      currentPlayerId: null,
      turnEndsAt: null,
      turnOrder: [],
      pendingChest: null,
      challenge: null,
      finalRoundTarget: null,
      winnerIds: [],
      event: null,
      revision: 0,
    };
    timers.set(code, {});
    const player = newPlayer(room, checked.name, socketId);
    player.isHost = true;
    room.hostId = player.id;
    rooms.set(code, room);
    emitChange(room);
    return result(true, null, { code, playerId: player.id, resumeToken: player.resumeToken, room: publicRoom(room, now()) });
  }

  function joinRoom(socketId, inputCode, inputName) {
    const code = String(inputCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) return result(false, 'Please enter a valid 5-character room code.');
    const room = roomFor(code);
    if (!room) return result(false, 'Room not found.');
    if (room.phase !== 'LOBBY') return result(false, room.phase === 'GAME_OVER' ? 'The game has already ended.' : 'The game has already started.');
    if (room.players.length >= MAX_PLAYERS) return result(false, 'This room is full.');
    const checked = validateName(room, inputName);
    if (checked.error) return result(false, checked.error);
    const player = newPlayer(room, checked.name, socketId);
    emitChange(room);
    return result(true, null, { code, playerId: player.id, resumeToken: player.resumeToken, room: publicRoom(room, now()) });
  }

  function startRoom(code, playerId) {
    const room = roomFor(code);
    if (!room) return result(false, 'Room not found.');
    if (room.phase !== 'LOBBY') return result(false, 'This room cannot be started right now.');
    if (playerId !== room.hostId) return result(false, 'Only the host can start the game.');
    if (room.players.filter((player) => player.connected).length < MIN_PLAYERS) return result(false, 'At least 2 connected players are needed.');
    room.board = makeBoard(random);
    room.players.forEach((player) => {
      player.position = { x: 0, y: 0 };
      player.score = 0;
      player.treasures = 0;
      player.rareTreasures = 0;
      player.shield = false;
      player.doublePoints = false;
      player.turnsTaken = 0;
    });
    room.turnOrder = room.players.map((player) => player.id);
    room.currentPlayerId = room.turnOrder[0];
    room.phase = 'PLAYING';
    room.finalRoundTarget = null;
    room.winnerIds = [];
    room.event = { title: 'The hunt begins!', detail: 'Collect treasure, watch for traps, and stay in the lead.', kind: 'start' };
    startTurnTimer(room);
    emitChange(room);
    return result(true, null, { room: publicRoom(room, now()) });
  }

  function startTurnTimer(room) {
    room.turnEndsAt = now() + TURN_MS;
    setTimer(room, 'turn', TURN_MS, () => {
      if (!['PLAYING', 'FINAL_ROUND', 'CHEST_DECISION'].includes(room.phase)) return;
      if (room.pendingChest) {
        room.event = { title: 'Safe choice selected', detail: 'The turn expired, so the safe reward was chosen.', kind: 'chest' };
        applyChestChoice(room, 'safe', true);
      }
      finishTurn(room, 'Time is up. Turn skipped.');
    });
  }

  function playerOnTurn(room, playerId) {
    if (!['PLAYING', 'FINAL_ROUND'].includes(room.phase)) return { error: 'It is not a move phase.' };
    if (room.currentPlayerId !== playerId) return { error: 'Wait for your turn.' };
    const player = findPlayer(room, playerId);
    if (!player?.connected) return { error: 'This player is disconnected.' };
    return { player };
  }

  function addScore(player, points) {
    player.score = Math.max(0, player.score + points);
  }

  function consumeTile(room, tile) {
    tile.active = false;
    tile.type = 'empty';
    tile.revealed = true;
  }

  function availableTeleportTiles(room, player) {
    return room.board.filter((tile) => {
      const x = tile.id % BOARD_SIZE;
      const y = Math.floor(tile.id / BOARD_SIZE);
      return !(x === player.position.x && y === player.position.y) && !room.players.some((other) => other.id !== player.id && other.position.x === x && other.position.y === y);
    });
  }

  function teleport(room, player) {
    const destinations = availableTeleportTiles(room, player);
    if (!destinations.length) return false;
    const target = destinations[Math.floor(random() * destinations.length)];
    player.position = { x: target.id % BOARD_SIZE, y: Math.floor(target.id / BOARD_SIZE) };
    target.revealed = true;
    return true;
  }

  function maybeStartFinalRound(room) {
    if (room.finalRoundTarget !== null || !room.players.some((player) => player.score >= TARGET_SCORE)) return;
    room.phase = 'FINAL_ROUND';
    room.finalRoundTarget = Math.max(...room.players.map((player) => player.turnsTaken));
    room.event = { title: 'Final round!', detail: 'Everyone gets the same number of turns to make their last move.', kind: 'final' };
  }

  function finishTurn(room, message) {
    stopTimer(room.code, 'turn');
    const current = findPlayer(room, room.currentPlayerId);
    if (current) current.turnsTaken += 1;
    if (message) room.event = { title: message, detail: '', kind: 'turn' };
    room.pendingChest = null;
    room.turnEndsAt = null;
    maybeStartFinalRound(room);
    if (room.finalRoundTarget !== null && room.players.every((player) => player.turnsTaken >= room.finalRoundTarget)) {
      finishGame(room);
      return;
    }
    const index = room.turnOrder.indexOf(room.currentPlayerId);
    room.currentPlayerId = room.turnOrder[(index + 1) % room.turnOrder.length];
    room.phase = room.finalRoundTarget === null ? 'PLAYING' : 'FINAL_ROUND';
    room.pendingChest = null;
    startTurnTimer(room);
    emitChange(room);
  }

  function finishGame(room) {
    stopTimer(room.code, 'turn');
    stopTimer(room.code, 'challenge-go');
    stopTimer(room.code, 'challenge-end');
    const sorted = [...room.players].sort((a, b) => b.score - a.score || b.treasures - a.treasures || b.rareTreasures - a.rareTreasures);
    const top = sorted[0];
    room.winnerIds = sorted.filter((player) => player.score === top.score && player.treasures === top.treasures && player.rareTreasures === top.rareTreasures).map((player) => player.id);
    room.phase = 'GAME_OVER';
    room.turnEndsAt = null;
    room.currentPlayerId = null;
    room.event = { title: room.winnerIds.length > 1 ? 'Shared victory!' : `${top.name} wins!`, detail: 'The final scores are in.', kind: 'winner' };
    emitChange(room);
  }

  function resolveChallenge(room, winnerId) {
    if (!room.challenge) return;
    stopTimer(room.code, 'challenge-go');
    stopTimer(room.code, 'challenge-end');
    const challenge = room.challenge;
    if (winnerId) {
      const loserId = winnerId === challenge.challengerId ? challenge.opponentId : challenge.challengerId;
      addScore(findPlayer(room, winnerId), 20);
      addScore(findPlayer(room, loserId), -10);
      room.event = { title: `${findPlayer(room, winnerId).name} wins Quick Draw!`, detail: '+20 points; opponent loses 10.', kind: 'challenge' };
    } else {
      room.event = { title: 'Quick Draw: no result', detail: 'No score changes this time.', kind: 'challenge' };
    }
    room.challenge = null;
    room.phase = room.finalRoundTarget === null ? 'PLAYING' : 'FINAL_ROUND';
    finishTurn(room);
  }

  function applyTile(room, player) {
    const tile = room.board[player.position.y * BOARD_SIZE + player.position.x];
    tile.revealed = true;
    if (!tile.active) return;
    const type = tile.type;
    if (TREASURE_VALUES[type]) {
      const base = TREASURE_VALUES[type];
      const value = base * (player.doublePoints ? 2 : 1);
      player.doublePoints = false;
      addScore(player, value);
      player.treasures += 1;
      if (type !== 'gold') player.rareTreasures += 1;
      room.event = { title: `+${value} ${type}!`, detail: `${player.name} collected ${type}.`, kind: 'treasure' };
      consumeTile(room, tile);
      return;
    }
    if (type === 'trap') {
      if (player.shield) {
        player.shield = false;
        room.event = { title: 'Shield protected you!', detail: 'Your shield blocked the trap.', kind: 'shield' };
      } else {
        addScore(player, -20);
        room.event = { title: 'Trap!', detail: '-20 points.', kind: 'trap' };
      }
      consumeTile(room, tile);
      return;
    }
    if (type === 'mystery') {
      const events = ['bonus', 'penalty', 'teleport', 'shield', 'double', 'steal'];
      const event = events[Math.floor(random() * events.length)];
      if (event === 'bonus') { addScore(player, 20); room.event = { title: 'Mystery: hidden treasure!', detail: '+20 points.', kind: 'mystery' }; }
      if (event === 'penalty') { addScore(player, -15); room.event = { title: 'Mystery: bad luck!', detail: '-15 points.', kind: 'mystery' }; }
      if (event === 'teleport') { teleport(room, player); room.event = { title: 'Mystery: teleport!', detail: 'You were moved to another tile.', kind: 'teleport' }; }
      if (event === 'shield') { player.shield = true; room.event = { title: 'Mystery: shield found!', detail: 'Your shield will block one trap.', kind: 'mystery' }; }
      if (event === 'double') { player.doublePoints = true; room.event = { title: 'Mystery: double points!', detail: 'Your next treasure is worth double.', kind: 'mystery' }; }
      if (event === 'steal') {
        const target = room.players.filter((other) => other.id !== player.id && other.score > 0).sort((a, b) => b.score - a.score)[0];
        if (target) { const stolen = Math.min(15, target.score); addScore(target, -stolen); addScore(player, stolen); room.event = { title: 'Mystery: a little heist!', detail: `You stole ${stolen} points from ${target.name}.`, kind: 'mystery' }; }
        else { addScore(player, 15); room.event = { title: 'Mystery: empty pockets!', detail: 'No rival had points to steal, so you found +15 instead.', kind: 'mystery' }; }
      }
      consumeTile(room, tile);
      return;
    }
    if (type === 'shield' || type === 'double') {
      player[type === 'shield' ? 'shield' : 'doublePoints'] = true;
      room.event = { title: type === 'shield' ? 'Shield collected!' : 'Double points collected!', detail: type === 'shield' ? 'You are protected from one trap.' : 'Your next treasure is doubled.', kind: 'powerup' };
      consumeTile(room, tile);
      return;
    }
    if (type === 'teleport') {
      teleport(room, player);
      room.event = { title: 'Teleport!', detail: 'You have been moved to a new tile.', kind: 'teleport' };
      consumeTile(room, tile);
      return;
    }
    if (type === 'chest') {
      room.phase = 'CHEST_DECISION';
      room.pendingChest = { playerId: player.id, tileId: tile.id };
      room.event = { title: 'Choose your reward', detail: 'Take +15 safely or risk a bigger reward.', kind: 'chest' };
      return;
    }
    if (type === 'challenge') {
      consumeTile(room, tile);
      const opponent = room.players.find((other) => other.id !== player.id && other.connected);
      if (!opponent) { room.event = { title: 'Quick Draw cancelled', detail: 'There is no connected opponent.', kind: 'challenge' }; return; }
      const challenge = { challengerId: player.id, opponentId: opponent.id, stage: 'ready', goAt: now() + 2000, endsAt: null, winnerId: null };
      room.challenge = challenge;
      room.phase = 'CHALLENGE';
      setTimer(room, 'challenge-go', 2000, () => {
        if (!room.challenge) return;
        room.challenge.stage = 'go';
        room.challenge.goAt = now();
        room.challenge.endsAt = now() + 8000;
        setTimer(room, 'challenge-end', 8000, () => resolveChallenge(room, room.challenge?.winnerId || null));
        emitChange(room);
      });
      emitChange(room);
    }
  }

  function move(code, playerId, direction) {
    const room = roomFor(code);
    if (!room) return result(false, 'Room not found.');
    const checked = playerOnTurn(room, playerId);
    if (checked.error) return result(false, checked.error);
    const delta = DIRECTIONS[String(direction || '').toLowerCase()];
    if (!delta) return result(false, 'Choose up, down, left, or right.');
    const x = checked.player.position.x + delta[0];
    const y = checked.player.position.y + delta[1];
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return result(false, 'You cannot move outside the map.');
    checked.player.position = { x, y };
    applyTile(room, checked.player);
    if (room.phase === 'CHEST_DECISION' || room.phase === 'CHALLENGE') {
      emitChange(room);
      return result(true, null, { room: publicRoom(room, now()) });
    }
    finishTurn(room);
    return result(true, null, { room: publicRoom(room, now()) });
  }

  function applyChestChoice(room, choice, automatic = false) {
    if (!room.pendingChest) return false;
    const player = findPlayer(room, room.pendingChest.playerId);
    const tile = room.board[room.pendingChest.tileId];
    if (tile) consumeTile(room, tile);
    player.treasures += 1;
    player.rareTreasures += 1;
    if (choice === 'safe') {
      addScore(player, 15);
      room.event = { title: 'Safe reward!', detail: '+15 points guaranteed.', kind: 'chest' };
    } else if (random() < 0.7) {
      addScore(player, 50);
      room.event = { title: 'Risk paid off!', detail: '+50 points!', kind: 'chest' };
    } else {
      addScore(player, -30);
      room.event = { title: 'The chest was a trap!', detail: '-30 points.', kind: 'chest' };
    }
    room.pendingChest = null;
    room.phase = room.finalRoundTarget === null ? 'PLAYING' : 'FINAL_ROUND';
    return !automatic;
  }

  function chooseChest(code, playerId, choice) {
    const room = roomFor(code);
    if (!room || room.phase !== 'CHEST_DECISION' || room.pendingChest?.playerId !== playerId) return result(false, 'There is no chest choice waiting for you.');
    if (!['safe', 'risky'].includes(choice)) return result(false, 'Choose safe or risky.');
    applyChestChoice(room, choice);
    finishTurn(room);
    return result(true, null, { room: publicRoom(room, now()) });
  }

  function quickDraw(code, playerId) {
    const room = roomFor(code);
    const challenge = room?.challenge;
    if (!challenge || room.phase !== 'CHALLENGE') return result(false, 'There is no Quick Draw in progress.');
    if (challenge.stage !== 'go' || now() < challenge.goAt) return result(false, 'Wait for GO!');
    if (![challenge.challengerId, challenge.opponentId].includes(playerId)) return result(false, 'You are not part of this challenge.');
    if (challenge.winnerId) return result(false, 'The challenge has already ended.');
    challenge.winnerId = playerId;
    resolveChallenge(room, playerId);
    return result(true, null, { room: publicRoom(room, now()) });
  }

  function disconnect(socketId) {
    for (const room of rooms.values()) {
      const player = room.players.find((item) => item.socketId === socketId && item.connected);
      if (!player) continue;
      player.connected = false;
      player.socketId = null;
      room.event = { title: `${player.name} disconnected.`, detail: room.event?.detail || '', kind: 'disconnect' };
      if (player.isHost) {
        const nextHost = room.players.find((item) => item.connected);
        if (nextHost) {
          findPlayer(room, room.hostId).isHost = false;
          room.hostId = nextHost.id;
          nextHost.isHost = true;
        }
      }
      if (room.challenge && [room.challenge.challengerId, room.challenge.opponentId].includes(player.id)) {
        room.challenge = null;
        stopTimer(room.code, 'challenge-go');
        stopTimer(room.code, 'challenge-end');
        room.phase = room.finalRoundTarget === null ? 'PLAYING' : 'FINAL_ROUND';
        finishTurn(room, 'Challenge cancelled after a disconnect.');
      } else {
        emitChange(room);
      }
      return { code: room.code, playerId: player.id };
    }
    return null;
  }

  function leave(socketId, code) {
    const room = roomFor(code);
    const player = room?.players.find((item) => item.socketId === socketId && item.connected);
    if (!room || !player) return result(false, 'You are not connected to that room.');
    if (!['LOBBY', 'GAME_OVER'].includes(room.phase)) {
      disconnect(socketId);
      return result(true);
    }
    room.players = room.players.filter((item) => item.id !== player.id);
    if (player.isHost) {
      room.hostId = room.players[0]?.id || null;
      if (room.hostId) findPlayer(room, room.hostId).isHost = true;
    }
    if (room.players.length === 0) {
      for (const timer of Object.values(timers.get(room.code) || {})) cancel(timer);
      timers.delete(room.code);
      rooms.delete(room.code);
    } else {
      room.event = { title: `${player.name} left the room.`, detail: '', kind: 'disconnect' };
      emitChange(room);
    }
    return result(true);
  }

  function reconnect(socketId, code, token) {
    const room = roomFor(code);
    const player = room?.players.find((item) => item.resumeToken && item.resumeToken === token);
    if (!room || !player || player.connected || room.phase === 'GAME_OVER') return result(false, 'Could not reconnect to that player.');
    player.connected = true;
    player.socketId = socketId;
    emitChange(room);
    return result(true, null, { code: room.code, playerId: player.id, room: publicRoom(room, now()) });
  }

  function replay(code, playerId) {
    const room = roomFor(code);
    if (!room || room.phase !== 'GAME_OVER') return result(false, 'This game is not ready to replay.');
    if (room.hostId !== playerId) return result(false, 'Only the host can start a replay.');
    if (room.players.filter((player) => player.connected).length < MIN_PLAYERS) return result(false, 'At least 2 connected players are needed.');
    room.phase = 'LOBBY';
    room.board = [];
    room.currentPlayerId = null;
    room.finalRoundTarget = null;
    room.winnerIds = [];
    room.challenge = null;
    room.pendingChest = null;
    room.turnOrder = room.players.map((player) => player.id);
    room.players.forEach((player) => {
      player.score = 0;
      player.treasures = 0;
      player.rareTreasures = 0;
      player.turnsTaken = 0;
      player.position = { x: 0, y: 0 };
      player.shield = false;
      player.doublePoints = false;
    });
    emitChange(room);
    return startRoom(code, playerId);
  }

  function getRoom(code) {
    const room = roomFor(code);
    return room ? publicRoom(room, now()) : null;
  }

  function getSocketPlayer(code, socketId) {
    const room = roomFor(code);
    return room?.players.find((player) => player.socketId === socketId) || null;
  }

  function dispose() {
    for (const roomTimers of timers.values()) for (const timer of Object.values(roomTimers)) cancel(timer);
    timers.clear();
  }

  return { rooms, createRoom, joinRoom, startRoom, move, chooseChest, quickDraw, disconnect, leave, reconnect, replay, getRoom, getSocketPlayer, publicRoom, dispose };
}

module.exports = { createGameManager, BOARD_SIZE, MAX_PLAYERS, MIN_PLAYERS, TURN_MS, TARGET_SCORE, makeBoard };
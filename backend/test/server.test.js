const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { io: createClient } = require('socket.io-client');
const { createServer } = require('../src/server');

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(3000).emit(event, payload, (timeout, response) => {
      if (timeout) reject(new Error(`${event} acknowledgement timed out`));
      else resolve(response);
    });
  });
}

function waitForRoom(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('room:update', onUpdate);
      reject(new Error('Timed out waiting for synchronized room update'));
    }, 3000);
    const onUpdate = (room) => {
      if (!predicate(room)) return;
      clearTimeout(timeout);
      socket.off('room:update', onUpdate);
      resolve(room);
    };
    socket.on('room:update', onUpdate);
  });
}

test('two Socket.IO clients share lobby, board, turn, movement, and score state', async () => {
  const service = createServer();
  service.httpServer.listen(0);
  await once(service.httpServer, 'listening');
  const address = service.httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  const first = createClient(url, { transports: ['websocket'], reconnection: false });
  const second = createClient(url, { transports: ['websocket'], reconnection: false });
  try {
    await Promise.all([once(first, 'connect'), once(second, 'connect')]);
    const firstLobbyUpdate = waitForRoom(first, (room) => room.players.length === 2);
    const created = await emitAck(first, 'room:create', { name: 'Alex' });
    assert.equal(created.ok, true);
    const joined = await emitAck(second, 'room:join', { code: created.code, name: 'Mina' });
    assert.equal(joined.ok, true);
    const firstLobby = await firstLobbyUpdate;
    const secondLobby = joined.room;
    assert.deepEqual(firstLobby.players.map((player) => player.name), ['Alex', 'Mina']);
    assert.deepEqual(secondLobby.players.map((player) => player.id), firstLobby.players.map((player) => player.id));

    assert.equal((await emitAck(second, 'room:start', { code: created.code })).ok, false);
    const firstStarted = waitForRoom(first, (room) => room.phase === 'PLAYING');
    const secondStarted = waitForRoom(second, (room) => room.phase === 'PLAYING');
    assert.equal((await emitAck(first, 'room:start', { code: created.code })).ok, true);
    const [firstGame, secondGame] = await Promise.all([firstStarted, secondStarted]);
    assert.deepEqual(firstGame.board, secondGame.board);
    assert.equal(firstGame.currentPlayerId, secondGame.currentPlayerId);

    const liveRoom = service.manager.rooms.get(created.code);
    liveRoom.players[0].score = 95;
    Object.assign(liveRoom.board[1], { type: 'gold', active: true, revealed: false });
    const firstMoved = waitForRoom(first, (room) => room.currentPlayerId === joined.playerId);
    const secondMoved = waitForRoom(second, (room) => room.currentPlayerId === joined.playerId);
    assert.equal((await emitAck(first, 'game:move', { code: created.code, direction: 'right' })).ok, true);
    const [firstAfterMove, secondAfterMove] = await Promise.all([firstMoved, secondMoved]);
    assert.deepEqual(firstAfterMove.players[0].position, { x: 1, y: 0 });
    assert.deepEqual(firstAfterMove.players, secondAfterMove.players);
    assert.deepEqual(firstAfterMove.leaderboard, secondAfterMove.leaderboard);
    assert.equal(firstAfterMove.phase, 'FINAL_ROUND');
    assert.equal(firstAfterMove.players[0].score, 105);

    const firstFinished = waitForRoom(first, (room) => room.phase === 'GAME_OVER');
    const secondFinished = waitForRoom(second, (room) => room.phase === 'GAME_OVER');
    assert.equal((await emitAck(second, 'game:move', { code: created.code, direction: 'right' })).ok, true);
    const [firstFinal, secondFinal] = await Promise.all([firstFinished, secondFinished]);
    assert.deepEqual(firstFinal.winnerIds, [created.playerId]);
    assert.deepEqual(firstFinal.players, secondFinal.players);
    assert.deepEqual(firstFinal.winnerIds, secondFinal.winnerIds);

    const firstReplay = waitForRoom(first, (room) => room.phase === 'PLAYING' && room.players.every((player) => player.score === 0));
    const secondReplay = waitForRoom(second, (room) => room.phase === 'PLAYING' && room.players.every((player) => player.score === 0));
    assert.equal((await emitAck(first, 'room:replay', { code: created.code })).ok, true);
    const [firstAgain, secondAgain] = await Promise.all([firstReplay, secondReplay]);
    assert.deepEqual(firstAgain.board, secondAgain.board);
    assert.deepEqual(firstAgain.players, secondAgain.players);
  } finally {
    first.disconnect();
    second.disconnect();
    service.manager.dispose();
    await new Promise((resolve) => service.io.close(resolve));
  }
});
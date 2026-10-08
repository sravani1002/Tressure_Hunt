const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { createGameManager } = require('./game');

function createServer(options = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: options.allowedOrigin || true }, transports: ['websocket', 'polling'] });
  const manager = createGameManager({ onChange: (code, room) => io.to(code).emit('room:update', room) });
  const distPath = path.resolve(__dirname, '../../frontend/dist');

  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  app.use(express.static(distPath));
  app.get('*', (_request, response, next) => {
    response.sendFile(path.join(distPath, 'index.html'), (error) => {
      if (error) next();
    });
  });

  function reply(callback, value) {
    if (typeof callback === 'function') callback(value);
  }

  function sendError(callback, error) {
    reply(callback, { ok: false, error: error || 'Something went wrong. Please try again.' });
  }

  function playerFor(socket, code) {
    if (!code || code !== socket.data.roomCode) return null;
    return manager.getSocketPlayer(code, socket.id);
  }

  function protect(socket, callback, action) {
    try {
      action();
    } catch (error) {
      console.error('Socket action failed:', error);
      sendError(callback);
    }
  }

  io.on('connection', (socket) => {
    socket.on('room:create', (payload = {}, callback) => protect(socket, callback, () => {
      const response = manager.createRoom(socket.id, payload.name);
      if (!response.ok) return sendError(callback, response.error);
      socket.data.roomCode = response.code;
      socket.data.playerId = response.playerId;
      socket.join(response.code);
      reply(callback, response);
    }));

    socket.on('room:join', (payload = {}, callback) => protect(socket, callback, () => {
      const response = manager.joinRoom(socket.id, payload.code, payload.name);
      if (!response.ok) return sendError(callback, response.error);
      socket.data.roomCode = response.code;
      socket.data.playerId = response.playerId;
      socket.join(response.code);
      reply(callback, response);
    }));

    socket.on('room:reconnect', (payload = {}, callback) => protect(socket, callback, () => {
      const response = manager.reconnect(socket.id, payload.code, payload.resumeToken);
      if (!response.ok) return sendError(callback, response.error);
      socket.data.roomCode = response.code;
      socket.data.playerId = response.playerId;
      socket.join(response.code);
      reply(callback, response);
    }));

    socket.on('room:leave', (payload = {}, callback) => protect(socket, callback, () => {
      if (payload.code !== socket.data.roomCode) return sendError(callback, 'You are not connected to that room.');
      const response = manager.leave(socket.id, payload.code);
      if (!response.ok) return sendError(callback, response.error);
      socket.leave(payload.code);
      socket.data.roomCode = null;
      socket.data.playerId = null;
      reply(callback, response);
    }));

    socket.on('room:start', (payload = {}, callback) => protect(socket, callback, () => {
      const player = playerFor(socket, payload.code);
      if (!player) return sendError(callback, 'You are not connected to that room.');
      const response = manager.startRoom(payload.code, player.id);
      if (!response.ok) return sendError(callback, response.error);
      reply(callback, response);
    }));

    socket.on('game:move', (payload = {}, callback) => protect(socket, callback, () => {
      const player = playerFor(socket, payload.code);
      if (!player) return sendError(callback, 'You are not connected to that room.');
      const response = manager.move(payload.code, player.id, payload.direction);
      if (!response.ok) return sendError(callback, response.error);
      reply(callback, response);
    }));

    socket.on('game:chest', (payload = {}, callback) => protect(socket, callback, () => {
      const player = playerFor(socket, payload.code);
      if (!player) return sendError(callback, 'You are not connected to that room.');
      const response = manager.chooseChest(payload.code, player.id, payload.choice);
      if (!response.ok) return sendError(callback, response.error);
      reply(callback, response);
    }));

    socket.on('game:quick-draw', (payload = {}, callback) => protect(socket, callback, () => {
      const player = playerFor(socket, payload.code);
      if (!player) return sendError(callback, 'You are not connected to that room.');
      const response = manager.quickDraw(payload.code, player.id);
      if (!response.ok) return sendError(callback, response.error);
      reply(callback, response);
    }));

    socket.on('room:replay', (payload = {}, callback) => protect(socket, callback, () => {
      const player = playerFor(socket, payload.code);
      if (!player) return sendError(callback, 'You are not connected to that room.');
      const response = manager.replay(payload.code, player.id);
      if (!response.ok) return sendError(callback, response.error);
      reply(callback, response);
    }));

    socket.on('disconnect', () => {
      manager.disconnect(socket.id);
      socket.data.roomCode = null;
      socket.data.playerId = null;
    });
  });

  return { app, httpServer, io, manager };
}

if (require.main === module) {
  const { httpServer, manager } = createServer();
  const port = Number(process.env.PORT) || 4000;
  httpServer.listen(port, () => console.log(`Treasure Rush server ready on http://localhost:${port}`));
  const shutdown = () => {
    manager.dispose();
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer };
const roomManager = require('../services/roomManager');
const duelService = require('../services/duelService');

// Configurable disconnect grace window (default: 60,000ms = 60s)
const DISCONNECT_GRACE_MS = process.env.DISCONNECT_GRACE_MS 
  ? Number(process.env.DISCONNECT_GRACE_MS) 
  : 60000;

// Registry of pending disconnect grace timers: Map<`${roomCode}_${userId}`, TimeoutId>
const disconnectTimers = new Map();

/**
 * Registers real-time event handlers for the live Duel phase
 * @param {import('socket.io').Server} io - Global Socket.IO server instance
 * @param {import('socket.io').Socket} socket - Authenticated socket instance
 */
function registerDuelHandlers(io, socket) {
  const currentUser = socket.data.user;

  function emitError(code, message, callback) {
    socket.emit('room:error', { code, message });
    if (typeof callback === 'function') {
      callback({ success: false, code, error: message });
    }
  }

  // 1. DUEL FORFEIT
  socket.on('duel:forfeit', async (payload = {}, callback) => {
    try {
      const roomCode = payload.roomCode || socket.data.roomCode;
      if (!roomCode) {
        return emitError('NO_ROOM', 'Not associated with any duel room', callback);
      }

      const room = roomManager.getRoom(roomCode);
      if (!room) {
        return emitError('ROOM_NOT_FOUND', 'Room not found', callback);
      }

      if (room.status !== 'ACTIVE') {
        return emitError('NOT_ACTIVE', 'Can only forfeit an ongoing ACTIVE duel', callback);
      }

      if (!room.players.has(currentUser.id)) {
        return emitError('NOT_PARTICIPANT', 'You are not a participant in this duel', callback);
      }

      // Identify winner (the opponent)
      const players = Array.from(room.players.values());
      const opponent = players.find(p => p.id !== currentUser.id);

      // Transition to FINISHED in RoomManager memory
      room.finishMatch({
        winnerId: opponent ? opponent.id : null,
        endReason: 'FORFEIT'
      });

      // Clear any pending disconnect timers for this room
      for (const [key, timer] of disconnectTimers.entries()) {
        if (key.startsWith(`${room.roomCode}_`)) {
          clearTimeout(timer);
          disconnectTimers.delete(key);
        }
      }

      // Persist outcome via duelService PostgreSQL ACID transaction
      let resolutionResult = null;
      try {
        resolutionResult = await duelService.resolveMatch(
          room.roomCode, 
          opponent ? opponent.id : null, 
          'FORFEIT'
        );
      } catch (dbErr) {
        console.warn(`[SOCKET] Warning: Could not persist forfeit for room ${room.roomCode}:`, dbErr.message);
      }

      const duelEndPayload = {
        roomCode: room.roomCode,
        winnerId: opponent ? opponent.id : null,
        winnerHandle: opponent ? opponent.cfHandle : null,
        loserId: currentUser.id,
        reason: 'FORFEIT',
        isDraw: false,
        endedAt: room.endedAt ? room.endedAt.toISOString() : new Date().toISOString(),
        userStats: resolutionResult ? {
          winner: resolutionResult.winner,
          loser: resolutionResult.loser
        } : null
      };

      io.to(room.roomCode).emit('duel:ended', duelEndPayload);
      io.to(room.roomCode).emit('room:state_update', room.toDTO());

      if (typeof callback === 'function') {
        callback({ success: true, ...duelEndPayload });
      }
    } catch (err) {
      console.error(`[SOCKET] duel:forfeit error:`, err.message);
      emitError('FORFEIT_FAILED', err.message, callback);
    }
  });

  // 2. RECONNECTION & STATE SYNCHRONIZATION
  socket.on('duel:request_sync', (payload = {}, callback) => {
    try {
      const roomCode = payload.roomCode || socket.data.roomCode;
      if (!roomCode) {
        return emitError('NO_ROOM', 'Room code is required for synchronization', callback);
      }

      const room = roomManager.getRoom(roomCode);
      if (!room) {
        return emitError('ROOM_NOT_FOUND', 'Room not found or has expired', callback);
      }

      if (!room.players.has(currentUser.id)) {
        return emitError('NOT_PARTICIPANT', 'You are not a participant in this room', callback);
      }

      // Reattach socket to channel
      socket.join(room.roomCode);
      socket.data.roomCode = room.roomCode;

      // Check for and cancel any active disconnect grace timer for this user
      const timerKey = `${room.roomCode}_${currentUser.id}`;
      if (disconnectTimers.has(timerKey)) {
        clearTimeout(disconnectTimers.get(timerKey));
        disconnectTimers.delete(timerKey);

        io.to(room.roomCode).emit('duel:player_reconnected', {
          roomCode: room.roomCode,
          userId: currentUser.id,
          username: currentUser.username
        });
      }

      const roomDTO = room.toDTO();
      const submissions = room.submissions || [];
      const syncResponse = {
        room: roomDTO,
        submissions,
        serverTime: new Date().toISOString()
      };

      socket.emit('duel:sync_response', syncResponse);
      socket.emit('duel:room_history_sync', {
        roomCode: room.roomCode,
        submissions
      });

      if (typeof callback === 'function') {
        callback({ success: true, ...syncResponse });
      }
    } catch (err) {
      console.error(`[SOCKET] duel:request_sync error:`, err.message);
      emitError('SYNC_FAILED', err.message, callback);
    }
  });

  // 3. DISCONNECT LISTENER (ACTIVE DUEL GRACE WINDOW)
  socket.on('disconnect', () => {
    try {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;

      const room = roomManager.getRoom(roomCode);
      if (!room || room.status !== 'ACTIVE') {
        return;
      }

      if (!room.players.has(currentUser.id)) {
        return;
      }

      const timerKey = `${room.roomCode}_${currentUser.id}`;

      // Avoid duplicate timers
      if (disconnectTimers.has(timerKey)) {
        clearTimeout(disconnectTimers.get(timerKey));
      }

      const reconnectWindowSeconds = Math.round(DISCONNECT_GRACE_MS / 1000);

      // Notify remaining players that an opponent has temporarily dropped
      io.to(room.roomCode).emit('duel:player_disconnected', {
        roomCode: room.roomCode,
        userId: currentUser.id,
        username: currentUser.username,
        reconnectWindowSeconds
      });

      // Start grace countdown
      const timer = setTimeout(async () => {
        disconnectTimers.delete(timerKey);

        const currentRoom = roomManager.getRoom(room.roomCode);
        if (!currentRoom || currentRoom.status !== 'ACTIVE') {
          return;
        }

        // Grace window expired -> match forfeited due to disconnect
        const players = Array.from(currentRoom.players.values());
        const remaining = players.find(p => p.id !== currentUser.id);

        currentRoom.finishMatch({
          winnerId: remaining ? remaining.id : null,
          endReason: 'PLAYER_DISCONNECT'
        });

        // Persist outcome via duelService PostgreSQL ACID transaction
        let resolutionResult = null;
        try {
          resolutionResult = await duelService.resolveMatch(
            currentRoom.roomCode,
            remaining ? remaining.id : null,
            'PLAYER_DISCONNECT'
          );
        } catch (dbErr) {
          console.warn(`[SOCKET] Warning: Could not persist disconnect expiration for ${currentRoom.roomCode}:`, dbErr.message);
        }

        const endPayload = {
          roomCode: currentRoom.roomCode,
          winnerId: remaining ? remaining.id : null,
          winnerHandle: remaining ? remaining.cfHandle : null,
          loserId: currentUser.id,
          reason: 'PLAYER_DISCONNECT',
          isDraw: !remaining,
          endedAt: currentRoom.endedAt ? currentRoom.endedAt.toISOString() : new Date().toISOString(),
          userStats: resolutionResult ? {
            winner: resolutionResult.winner,
            loser: resolutionResult.loser
          } : null
        };

        io.to(currentRoom.roomCode).emit('duel:ended', endPayload);
        io.to(currentRoom.roomCode).emit('room:state_update', currentRoom.toDTO());
      }, DISCONNECT_GRACE_MS);

      disconnectTimers.set(timerKey, timer);
    } catch (err) {
      console.error(`[SOCKET] Error handling active duel disconnect:`, err.message);
    }
  });
}

module.exports = registerDuelHandlers;

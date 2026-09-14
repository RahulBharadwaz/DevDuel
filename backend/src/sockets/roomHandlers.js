const roomManager = require('../services/roomManager');
const problemSelector = require('../services/problemSelector');
const duelService = require('../services/duelService');

// Configurable countdown duration (default: 5000ms)
const COUNTDOWN_MS = process.env.COUNTDOWN_MS ? Number(process.env.COUNTDOWN_MS) : 5000;

// Registry of active countdown timers: Map<roomCode, TimeoutId>
const countdownTimers = new Map();

function cancelCountdown(io, room, reason = 'Countdown canceled') {
  const timer = countdownTimers.get(room.roomCode);
  if (timer) {
    clearTimeout(timer);
    countdownTimers.delete(room.roomCode);
  }

  if (room.status === 'COUNTDOWN') {
    room.cancelCountdown(reason);
  }

  io.to(room.roomCode).emit('duel:countdown_cancelled', {
    roomCode: room.roomCode,
    reason
  });
  io.to(room.roomCode).emit('room:state_update', room.toDTO());
}

/**
 * Registers real-time event handlers for the Lobby phase and countdown initiation
 * @param {import('socket.io').Server} io - Global Socket.IO server instance
 * @param {import('socket.io').Socket} socket - Authenticated socket instance
 */
function registerRoomHandlers(io, socket) {
  const currentUser = socket.data.user;

  function emitError(code, message, callback) {
    socket.emit('room:error', { code, message });
    if (typeof callback === 'function') {
      callback({ success: false, code, error: message });
    }
  }

  // 1. CREATE ROOM
  socket.on('room:create', (payload = {}, callback) => {
    try {
      const { targetRating, durationMinutes } = payload;
      const room = roomManager.createRoom(currentUser, { targetRating, durationMinutes });

      socket.join(room.roomCode);
      socket.data.roomCode = room.roomCode;

      const roomDTO = room.toDTO();
      io.to(room.roomCode).emit('room:state_update', roomDTO);

      if (typeof callback === 'function') {
        callback({ success: true, room: roomDTO });
      }
    } catch (err) {
      console.error(`[SOCKET] room:create error for user ${currentUser?.username}:`, err.message);
      emitError('ROOM_CREATE_FAILED', err.message, callback);
    }
  });

  // 2. JOIN ROOM
  socket.on('room:join', (payload = {}, callback) => {
    try {
      const { roomCode } = payload;
      if (!roomCode || typeof roomCode !== 'string') {
        return emitError('INVALID_ROOM_CODE', 'A valid 6-character room code is required', callback);
      }

      const normalizedCode = roomCode.toUpperCase().trim();
      const existingRoom = roomManager.getRoom(normalizedCode);

      if (!existingRoom) {
        return emitError('ROOM_NOT_FOUND', `Room "${normalizedCode}" does not exist or has expired`, callback);
      }

      if (existingRoom.status !== 'WAITING') {
        return emitError('ROOM_IN_PROGRESS', 'Cannot join a match that is already in progress or finished', callback);
      }

      if (existingRoom.players.size >= 2 && !existingRoom.players.has(currentUser.id)) {
        return emitError('ROOM_FULL', 'Room is full (maximum 2 players)', callback);
      }

      const room = roomManager.joinRoom(normalizedCode, currentUser);
      socket.join(room.roomCode);
      socket.data.roomCode = room.roomCode;

      const roomDTO = room.toDTO();
      io.to(room.roomCode).emit('room:state_update', roomDTO);

      socket.emit('duel:room_history_sync', {
        roomCode: room.roomCode,
        submissions: room.submissions || []
      });

      if (typeof callback === 'function') {
        callback({ success: true, room: roomDTO });
      }
    } catch (err) {
      console.error(`[SOCKET] room:join error for user ${currentUser?.username}:`, err.message);
      emitError('ROOM_JOIN_FAILED', err.message, callback);
    }
  });

  // 3. TOGGLE READY & COUNTDOWN ORCHESTRATION
  socket.on('room:toggle_ready', async (payload = {}, callback) => {
    try {
      const roomCode = payload.roomCode || socket.data.roomCode;
      if (!roomCode) {
        return emitError('NO_ROOM', 'Not currently associated with any room', callback);
      }

      const room = roomManager.getRoom(roomCode);
      if (!room) {
        return emitError('ROOM_NOT_FOUND', 'Room not found', callback);
      }

      if (!room.players.has(currentUser.id)) {
        return emitError('NOT_IN_ROOM', 'You are not a participant in this room', callback);
      }

      // If room was already in COUNTDOWN and player un-readies: abort countdown
      if (room.status === 'COUNTDOWN') {
        const isReady = room.toggleReady(currentUser.id);
        cancelCountdown(io, room, `${currentUser.username} un-readied`);

        if (typeof callback === 'function') {
          callback({ success: true, isReady, room: room.toDTO() });
        }
        return;
      }

      // Toggle ready status in WAITING state
      const isReady = room.toggleReady(currentUser.id);
      const roomDTO = room.toDTO();
      io.to(room.roomCode).emit('room:state_update', roomDTO);

      if (typeof callback === 'function') {
        callback({ success: true, isReady, room: roomDTO });
      }

      // Evaluate whether countdown should begin
      if (room.canStartCountdown()) {
        room.startCountdown();

        const countdownDurationSeconds = Math.round(COUNTDOWN_MS / 1000);
        io.to(room.roomCode).emit('duel:starting', {
          roomCode: room.roomCode,
          countdownSeconds: countdownDurationSeconds
        });
        io.to(room.roomCode).emit('room:state_update', room.toDTO());

        // Start synchronized timer
        const timer = setTimeout(async () => {
          countdownTimers.delete(room.roomCode);

          if (room.status !== 'COUNTDOWN') {
            return;
          }

          try {
            // Select competitive programming problem matching configured difficulty
            const players = Array.from(room.players.values());
            const handles = players.map(p => p.cfHandle).filter(Boolean);

            const problem = await problemSelector.getRandomProblem({
              targetRating: room.targetRating,
              handles
            });

            // Transition state machine to ACTIVE
            room.startMatch(problem);

            // Persist match start to PostgreSQL
            try {
              await duelService.recordMatchStart(room);
            } catch (dbErr) {
              console.warn(`[SOCKET] Warning: Could not persist match start for ${room.roomCode}:`, dbErr.message);
            }

            const startedAtDate = room.startedAt || new Date();
            const endsAtDate = new Date(startedAtDate.getTime() + room.durationMinutes * 60 * 1000);

            const duelPayload = {
              roomCode: room.roomCode,
              startTime: startedAtDate.toISOString(),
              endsAt: endsAtDate.toISOString(),
              durationSeconds: room.durationMinutes * 60,
              problem: {
                contestId: problem.contestId,
                index: problem.index,
                name: problem.name,
                rating: problem.rating,
                tags: problem.tags,
                url: problem.url
              }
            };

            io.to(room.roomCode).emit('duel:started', duelPayload);
            io.to(room.roomCode).emit('room:state_update', room.toDTO());
          } catch (err) {
            console.error(`[SOCKET] Error starting duel for room ${room.roomCode}:`, err.message);
            cancelCountdown(io, room, `Failed to load duel problem: ${err.message}`);
          }
        }, COUNTDOWN_MS);

        countdownTimers.set(room.roomCode, timer);
      }
    } catch (err) {
      console.error(`[SOCKET] room:toggle_ready error:`, err.message);
      emitError('TOGGLE_READY_FAILED', err.message, callback);
    }
  });

  // 4. UPDATE CONFIG
  socket.on('room:update_config', (payload = {}, callback) => {
    try {
      const roomCode = payload.roomCode || socket.data.roomCode;
      if (!roomCode) {
        return emitError('NO_ROOM', 'Not currently associated with any room', callback);
      }

      const room = roomManager.getRoom(roomCode);
      if (!room) {
        return emitError('ROOM_NOT_FOUND', 'Room not found', callback);
      }

      // If in countdown, settings change cancels countdown
      if (room.status === 'COUNTDOWN') {
        cancelCountdown(io, room, 'Settings modified by host');
      }

      room.updateConfig({
        targetRating: payload.targetRating,
        durationMinutes: payload.durationMinutes
      }, currentUser.id);

      const roomDTO = room.toDTO();
      io.to(room.roomCode).emit('room:state_update', roomDTO);

      if (typeof callback === 'function') {
        callback({ success: true, room: roomDTO });
      }
    } catch (err) {
      console.error(`[SOCKET] room:update_config error:`, err.message);
      emitError('CONFIG_UPDATE_FAILED', err.message, callback);
    }
  });

  // 5. LEAVE ROOM
  socket.on('room:leave', (payload = {}, callback) => {
    try {
      const roomCode = payload.roomCode || socket.data.roomCode;
      if (!roomCode) {
        if (typeof callback === 'function') callback({ success: true });
        return;
      }

      const room = roomManager.getRoom(roomCode);
      if (room && room.status === 'COUNTDOWN') {
        const timer = countdownTimers.get(room.roomCode);
        if (timer) {
          clearTimeout(timer);
          countdownTimers.delete(room.roomCode);
        }
        room.cancelCountdown(`${currentUser.username} left the room`);
        io.to(room.roomCode).emit('duel:countdown_cancelled', {
          roomCode: room.roomCode,
          reason: `${currentUser.username} left the room`
        });
      }

      socket.leave(roomCode);
      delete socket.data.roomCode;

      const { room: updatedRoom, deleted } = roomManager.leaveRoom(roomCode, currentUser.id);

      if (!deleted && updatedRoom) {
        io.to(updatedRoom.roomCode).emit('room:state_update', updatedRoom.toDTO());
      }

      if (typeof callback === 'function') {
        callback({ success: true });
      }
    } catch (err) {
      console.error(`[SOCKET] room:leave error:`, err.message);
      emitError('ROOM_LEAVE_FAILED', err.message, callback);
    }
  });

  // 6. DISCONNECT (LOBBY & COUNTDOWN CLEANUP)
  socket.on('disconnect', () => {
    try {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;

      const room = roomManager.getRoom(roomCode);
      if (!room) return;

      if (room.status === 'COUNTDOWN') {
        const timer = countdownTimers.get(room.roomCode);
        if (timer) {
          clearTimeout(timer);
          countdownTimers.delete(room.roomCode);
        }
        room.cancelCountdown(`${currentUser.username} disconnected`);
        io.to(room.roomCode).emit('duel:countdown_cancelled', {
          roomCode: room.roomCode,
          reason: `${currentUser.username} disconnected`
        });
      }

      if (room.status === 'WAITING' || room.status === 'COUNTDOWN') {
        const { room: updatedRoom, deleted } = roomManager.leaveRoom(roomCode, currentUser.id);
        if (!deleted && updatedRoom) {
          io.to(updatedRoom.roomCode).emit('room:state_update', updatedRoom.toDTO());
        }
      }
    } catch (err) {
      console.error(`[SOCKET] Error during socket disconnect cleanup:`, err.message);
    }
  });
}

module.exports = registerRoomHandlers;

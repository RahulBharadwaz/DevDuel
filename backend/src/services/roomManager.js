const { Room } = require('../models/Room');
const { generateRoomCode } = require('../utils/codeGenerator');

class RoomManager {
  constructor() {
    // Map<roomCode, Room>
    this.rooms = new Map();
    // Map<userId, roomCode> for fast O(1) user presence lookups
    this.userToRoom = new Map();
  }

  /**
   * Create a new room with the requesting user as host
   * @param {object} hostUser - { id, username, cfHandle }
   * @param {object} [config={}] - { targetRating, durationMinutes }
   * @returns {Room}
   */
  createRoom(hostUser, config = {}) {
    if (!hostUser || !hostUser.id) {
      throw new Error('Valid host user object is required to create a room');
    }

    // If user is already registered in an active room, detach them first
    if (this.userToRoom.has(hostUser.id)) {
      const existingRoomCode = this.userToRoom.get(hostUser.id);
      this.leaveRoom(existingRoomCode, hostUser.id);
    }

    // Generate collision-resistant 6-character room code
    const roomCode = generateRoomCode(this.rooms);

    const room = new Room({
      roomCode,
      hostUser,
      targetRating: config.targetRating,
      durationMinutes: config.durationMinutes
    });

    this.rooms.set(roomCode, room);
    this.userToRoom.set(hostUser.id, roomCode);

    return room;
  }

  /**
   * Add a second player to an existing room
   * @param {string} roomCode 
   * @param {object} user - { id, username, cfHandle }
   * @returns {Room}
   */
  joinRoom(roomCode, user) {
    if (!roomCode || typeof roomCode !== 'string') {
      throw new Error('Room code is required to join a room');
    }
    if (!user || !user.id) {
      throw new Error('Valid user object is required to join a room');
    }

    const normalizedCode = roomCode.toUpperCase().trim();
    const room = this.rooms.get(normalizedCode);

    if (!room) {
      throw new Error(`Room "${normalizedCode}" not found or has expired`);
    }

    // If user is currently in another room, detach them first
    if (this.userToRoom.has(user.id)) {
      const currentCode = this.userToRoom.get(user.id);
      if (currentCode !== normalizedCode) {
        this.leaveRoom(currentCode, user.id);
      }
    }

    room.addPlayer(user);
    this.userToRoom.set(user.id, normalizedCode);

    return room;
  }

  /**
   * Remove a user from a room and clean up if empty
   * @param {string} roomCode 
   * @param {string} userId 
   * @returns {{ room: Room|null, deleted: boolean }}
   */
  leaveRoom(roomCode, userId) {
    if (!roomCode || !userId) {
      return { room: null, deleted: false };
    }

    const normalizedCode = roomCode.toUpperCase().trim();
    const room = this.rooms.get(normalizedCode);

    this.userToRoom.delete(userId);

    if (!room) {
      return { room: null, deleted: false };
    }

    room.removePlayer(userId);

    if (room.isEmpty()) {
      this.rooms.delete(normalizedCode);
      return { room: null, deleted: true };
    }

    return { room, deleted: false };
  }

  /**
   * Retrieve a room by its 6-character code
   * @param {string} roomCode 
   * @returns {Room|null}
   */
  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(roomCode.toUpperCase().trim()) || null;
  }

  /**
   * Retrieve active room occupied by a specific user
   * @param {string} userId 
   * @returns {Room|null}
   */
  getRoomByUserId(userId) {
    if (!userId) return null;
    const roomCode = this.userToRoom.get(userId);
    if (!roomCode) return null;
    return this.getRoom(roomCode);
  }

  /**
   * Garbage collector removing abandoned lobbies or old finished rooms
   * @param {number} [maxIdleMs=1800000] - 30 minutes idle timeout
   * @returns {number} Count of pruned rooms
   */
  cleanupAbandonedRooms(maxIdleMs = 30 * 60 * 1000) {
    let pruned = 0;
    const now = Date.now();

    for (const [code, room] of this.rooms.entries()) {
      const isFinishedAndOld = room.status === 'FINISHED' && (now - room.lastActivityAt.getTime()) > (10 * 60 * 1000);
      const isAbandoned = room.isExpired(maxIdleMs);

      if (isFinishedAndOld || isAbandoned || room.isEmpty()) {
        for (const playerId of room.players.keys()) {
          this.userToRoom.delete(playerId);
        }
        this.rooms.delete(code);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Clear all active rooms and mappings (primarily for test resets)
   */
  clear() {
    this.rooms.clear();
    this.userToRoom.clear();
  }
}

module.exports = new RoomManager();

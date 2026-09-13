const ROOM_STATUS = Object.freeze({
  WAITING: 'WAITING',
  COUNTDOWN: 'COUNTDOWN',
  ACTIVE: 'ACTIVE',
  FINISHED: 'FINISHED'
});

class StateTransitionError extends Error {
  constructor(from, to, reason = '') {
    super(`Illegal state transition from ${from} to ${to}${reason ? `: ${reason}` : ''}`);
    this.name = 'StateTransitionError';
  }
}

class Room {
  /**
   * @param {object} params
   * @param {string} params.roomCode - 6-character room code
   * @param {object} params.hostUser - User object of creator { id, username, cfHandle }
   * @param {number} [params.targetRating=1200] - Problem difficulty (800-3500)
   * @param {number} [params.durationMinutes=30] - Match duration (1-300)
   */
  constructor({ roomCode, hostUser, targetRating = 1200, durationMinutes = 30 }) {
    if (!roomCode || typeof roomCode !== 'string') {
      throw new Error('Room requires a valid roomCode');
    }
    if (!hostUser || !hostUser.id) {
      throw new Error('Room requires a valid hostUser');
    }

    this.roomCode = roomCode.toUpperCase().trim();
    this.hostId = hostUser.id;
    this.status = ROOM_STATUS.WAITING;

    // Configuration
    this.targetRating = this._validateRating(targetRating);
    this.durationMinutes = this._validateDuration(durationMinutes);

    // Players: Map<userId, PlayerRecord>
    this.players = new Map();
    this.addPlayer(hostUser, true);

    // Match specifics
    this.problem = null;
    this.winnerId = null;
    this.endReason = null;
    this.submissions = [];

    // Timestamps
    this.createdAt = new Date();
    this.countdownStartedAt = null;
    this.startedAt = null;
    this.endedAt = null;
    this.lastActivityAt = new Date();
  }

  /**
   * Adds or updates a submission in the room submission history
   * @param {object} submission - { id, submissionId, handle, verdict, passedTestCount, time }
   * @returns {object} Normalized submission object
   */
  addSubmission(submission) {
    if (!submission) return null;
    const id = submission.submissionId || submission.id;
    if (!id) return null;

    const normalized = {
      id: Number(id),
      submissionId: Number(id),
      handle: submission.handle,
      verdict: submission.verdict,
      passedTestCount: submission.passedTestCount || 0,
      time: submission.time || Math.floor(Date.now() / 1000)
    };

    const existingIndex = this.submissions.findIndex(
      s => s.id === normalized.id || s.submissionId === normalized.submissionId
    );

    if (existingIndex >= 0) {
      this.submissions[existingIndex] = { ...this.submissions[existingIndex], ...normalized };
    } else {
      this.submissions.push(normalized);
    }

    this._touch();
    return normalized;
  }

  _validateRating(rating) {
    const num = Number(rating);
    if (isNaN(num) || num < 800 || num > 3500) {
      throw new Error(`Rating must be between 800 and 3500 (received: ${rating})`);
    }
    return num;
  }

  _validateDuration(duration) {
    const num = Number(duration);
    if (isNaN(num) || num < 1 || num > 300) {
      throw new Error(`Duration must be between 1 and 300 minutes (received: ${duration})`);
    }
    return num;
  }

  _touch() {
    this.lastActivityAt = new Date();
  }

  /**
   * Add a player to the room
   * @param {object} user - { id, username, cfHandle }
   * @param {boolean} [isHost=false]
   */
  addPlayer(user, isHost = false) {
    if (this.status !== ROOM_STATUS.WAITING) {
      throw new StateTransitionError(this.status, 'JOIN', 'Cannot join a room that is not in WAITING state');
    }

    if (this.players.size >= 2 && !this.players.has(user.id)) {
      throw new Error('Room is full (maximum 2 players)');
    }

    const playerRecord = {
      id: user.id,
      username: user.username,
      cfHandle: user.cfHandle || user.cf_handle || user.username,
      isHost: isHost || this.players.size === 0,
      isReady: false,
      joinedAt: new Date()
    };

    this.players.set(user.id, playerRecord);
    this._touch();
    return playerRecord;
  }

  /**
   * Remove a player from the room
   * @param {string} userId 
   */
  removePlayer(userId) {
    const existed = this.players.delete(userId);
    if (!existed) return false;

    this._touch();

    // If a player leaves during COUNTDOWN, abort back to WAITING
    if (this.status === ROOM_STATUS.COUNTDOWN) {
      this.cancelCountdown('A player left during the countdown');
    }

    // If host left and another player remains, promote them to host
    if (this.hostId === userId && this.players.size > 0) {
      const nextHost = this.players.values().next().value;
      nextHost.isHost = true;
      this.hostId = nextHost.id;
    }

    // Reset ready status of remaining player
    for (const player of this.players.values()) {
      player.isReady = false;
    }

    return true;
  }

  /**
   * Toggle player readiness (only valid in WAITING state)
   * @param {string} userId 
   * @returns {boolean} New ready state
   */
  toggleReady(userId) {
    if (this.status !== ROOM_STATUS.WAITING && this.status !== ROOM_STATUS.COUNTDOWN) {
      throw new StateTransitionError(this.status, 'TOGGLE_READY', 'Cannot toggle ready outside of lobby');
    }

    const player = this.players.get(userId);
    if (!player) {
      throw new Error(`Player ${userId} is not in room ${this.roomCode}`);
    }

    player.isReady = !player.isReady;
    this._touch();

    // If in countdown and a player unreadies, cancel countdown back to WAITING
    if (this.status === ROOM_STATUS.COUNTDOWN && !player.isReady) {
      this.cancelCountdown('Player unreadied');
    }

    return player.isReady;
  }

  /**
   * Host updates target difficulty rating and match duration
   */
  updateConfig({ targetRating, durationMinutes }, requestingUserId) {
    if (this.status !== ROOM_STATUS.WAITING) {
      throw new StateTransitionError(this.status, 'UPDATE_CONFIG', 'Room settings can only be altered in WAITING state');
    }
    if (this.hostId !== requestingUserId) {
      throw new Error('Only the room host can modify duel settings');
    }

    if (targetRating !== undefined) {
      this.targetRating = this._validateRating(targetRating);
    }
    if (durationMinutes !== undefined) {
      this.durationMinutes = this._validateDuration(durationMinutes);
    }

    // Reset readiness on settings change to ensure both agree to new terms
    for (const player of this.players.values()) {
      player.isReady = false;
    }

    this._touch();
  }

  /**
   * Evaluates if conditions are met to begin countdown
   */
  canStartCountdown() {
    return (
      this.status === ROOM_STATUS.WAITING &&
      this.players.size === 2 &&
      Array.from(this.players.values()).every(p => p.isReady)
    );
  }

  /**
   * Transition: WAITING -> COUNTDOWN
   */
  startCountdown() {
    if (this.status !== ROOM_STATUS.WAITING) {
      throw new StateTransitionError(this.status, ROOM_STATUS.COUNTDOWN, 'Room must be in WAITING state');
    }
    if (!this.canStartCountdown()) {
      throw new StateTransitionError(
        this.status,
        ROOM_STATUS.COUNTDOWN,
        'Both players must be present and ready to initiate countdown'
      );
    }

    this.status = ROOM_STATUS.COUNTDOWN;
    this.countdownStartedAt = new Date();
    this._touch();
  }

  /**
   * Transition: COUNTDOWN -> WAITING (Abort)
   */
  cancelCountdown(reason = '') {
    if (this.status !== ROOM_STATUS.COUNTDOWN) {
      return;
    }

    this.status = ROOM_STATUS.WAITING;
    this.countdownStartedAt = null;
    this._touch();
  }

  /**
   * Transition: COUNTDOWN -> ACTIVE
   * Starts the live duel with the assigned problem.
   * @param {object} problem - Standardized problem object from problemSelector
   */
  startMatch(problem) {
    if (this.status !== ROOM_STATUS.COUNTDOWN) {
      throw new StateTransitionError(
        this.status,
        ROOM_STATUS.ACTIVE,
        'Duel can only be activated from COUNTDOWN state'
      );
    }
    if (!problem || !problem.contestId || !problem.index) {
      throw new Error('Cannot activate duel without a valid problem');
    }

    this.status = ROOM_STATUS.ACTIVE;
    this.problem = problem;
    this.startedAt = new Date();
    this._touch();
  }

  /**
   * Transition: ACTIVE -> FINISHED
   * Resolves the match with outcome details.
   * @param {object} resolution
   * @param {string|null} resolution.winnerId - UUID of winner or null for draw
   * @param {string} resolution.endReason - 'ACCEPTED_SUBMISSION' | 'TIMEOUT' | 'FORFEIT' | etc.
   */
  finishMatch({ winnerId = null, endReason = 'ACCEPTED_SUBMISSION' } = {}) {
    if (this.status !== ROOM_STATUS.ACTIVE) {
      throw new StateTransitionError(
        this.status,
        ROOM_STATUS.FINISHED,
        'Only an ACTIVE match can be transitioned to FINISHED'
      );
    }

    this.status = ROOM_STATUS.FINISHED;
    this.winnerId = winnerId;
    this.endReason = endReason;
    this.endedAt = new Date();
    this._touch();
  }

  /**
   * Checks whether the room is completely empty
   */
  isEmpty() {
    return this.players.size === 0;
  }

  /**
   * Checks if room has exceeded idle TTL
   * @param {number} ttlMs 
   */
  isExpired(ttlMs = 30 * 60 * 1000) {
    return (Date.now() - this.lastActivityAt.getTime()) > ttlMs;
  }

  /**
   * Serializes room state for client transmission
   */
  toDTO() {
    return {
      roomCode: this.roomCode,
      status: this.status,
      hostId: this.hostId,
      config: {
        targetRating: this.targetRating,
        durationMinutes: this.durationMinutes
      },
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        username: p.username,
        cfHandle: p.cfHandle,
        isHost: p.isHost,
        isReady: p.isReady
      })),
      problem: this.problem,
      submissions: this.submissions || [],
      winnerId: this.winnerId,
      endReason: this.endReason,
      countdownStartedAt: this.countdownStartedAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt
    };
  }
}

module.exports = {
  Room,
  ROOM_STATUS,
  StateTransitionError
};

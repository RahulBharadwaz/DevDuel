const roomManager = require('./roomManager');
const duelService = require('./duelService');
const codeforcesService = require('./codeforcesService');

class VerificationScheduler {
  constructor() {
    this.intervalId = null;
    this.io = null;
    this.isPolling = false;
    this.pollIntervalMs = process.env.POLL_INTERVAL_MS 
      ? Number(process.env.POLL_INTERVAL_MS) 
      : 5000;
    this.requestDelayMs = 250; // Delay between consecutive CF calls to stay well below 5 req/sec
    this.customSubmissionFetcher = null; // Test injection hook
    this.processedSubmissions = new Map(); // submissionId -> verdict tracker
  }

  /**
   * Start the 5-second polling scheduler loop
   * @param {import('socket.io').Server} io 
   * @param {number} [customIntervalMs]
   */
  startVerificationScheduler(io, customIntervalMs = null) {
    if (this.intervalId) {
      return;
    }

    this.io = io;
    const interval = customIntervalMs || this.pollIntervalMs;

    console.log(`[POLLEVER] Starting Codeforces Verification Scheduler (Interval: ${interval}ms)`);

    this.intervalId = setInterval(() => {
      this.tick().catch(err => {
        console.error('[POLLEVER UNHANDLED TICK ERROR]:', err);
      });
    }, interval);

    if (this.intervalId.unref) {
      this.intervalId.unref();
    }
  }

  /**
   * Stop the polling scheduler loop
   */
  stopVerificationScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[POLLEVER] Codeforces Verification Scheduler stopped.');
    }
  }

  /**
   * Helper delay to throttle calls according to leaky bucket / rate limit rules
   * @param {number} ms 
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch submissions with fallback to custom fetcher (for test mocking)
   */
  async _fetchSubmissions(handle) {
    if (typeof this.customSubmissionFetcher === 'function') {
      return await this.customSubmissionFetcher(handle);
    }
    return await codeforcesService.getUserSubmissions(handle, 10);
  }

  /**
   * Core polling tick: iterates active duels, checks timeouts, queries CF API, and resolves matches
   */
  async tick() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;

    try {
      // 1. Discover all currently ACTIVE duels
      const activeRooms = Array.from(roomManager.rooms.values()).filter(
        r => r.status === 'ACTIVE'
      );

      if (activeRooms.length === 0) {
        return;
      }

      for (const room of activeRooms) {
        // Confirm room is still ACTIVE
        if (room.status !== 'ACTIVE') {
          continue;
        }

        const startedAtMs = room.startedAt ? new Date(room.startedAt).getTime() : Date.now();
        const durationMs = (room.durationMinutes || 30) * 60 * 1000;
        const expiresAtMs = startedAtMs + durationMs;

        // 2. Authoritative Match Timeout Check
        if (Date.now() >= expiresAtMs) {
          try {
            const resolution = await duelService.handleTimeout(room.roomCode);

            if (this.io) {
              const timeoutPayload = {
                roomCode: room.roomCode,
                winnerId: null,
                winnerHandle: null,
                reason: 'TIMEOUT',
                isDraw: true,
                endedAt: new Date().toISOString(),
                userStats: null
              };
              this.io.to(room.roomCode).emit('duel:ended', timeoutPayload);
              this.io.to(room.roomCode).emit('room:state_update', room.toDTO());
            }
          } catch (timeoutErr) {
            console.error(`[POLLEVER] Error executing timeout for room ${room.roomCode}:`, timeoutErr.message);
          }
          continue;
        }

        // If room has no assigned problem, skip
        if (!room.problem || !room.problem.contestId || !room.problem.index) {
          continue;
        }

        const targetContestId = Number(room.problem.contestId);
        const targetIndex = String(room.problem.index).toUpperCase().trim();
        const startedAtEpoch = Math.floor(startedAtMs / 1000);

        const players = Array.from(room.players.values());

        // 3. Inspect Submissions for Each Player in the Duel
        for (const player of players) {
          if (!player.cfHandle) continue;

          // If room was resolved in an earlier iteration of this tick, halt
          if (room.status !== 'ACTIVE') break;

          try {
            // Apply leaky bucket throttling between CF API calls
            await this._sleep(this.requestDelayMs);

            const submissions = await this._fetchSubmissions(player.cfHandle);

            if (!Array.isArray(submissions) || submissions.length === 0) {
              continue;
            }

            for (const sub of submissions) {
              const subContestId = Number(sub.problem?.contestId);
              const subIndex = String(sub.problem?.index || '').toUpperCase().trim();
              const subCreationTime = Number(sub.creationTimeSeconds);

              // Verification Criteria:
              // 1. Contest ID matches
              // 2. Problem Index matches
              // 3. Submission was made AFTER the match started
              const isMatchProblem = (subContestId === targetContestId && subIndex === targetIndex);
              const isSubmittedAfterStart = (subCreationTime >= startedAtEpoch);

              if (isMatchProblem && isSubmittedAfterStart) {
                // Initialize room-level submission tracker to prevent repetitive terminal emissions
                if (!room.processedSubmissions) {
                  room.processedSubmissions = new Map();
                }

                const lastVerdict = room.processedSubmissions.get(sub.id) || this.processedSubmissions.get(sub.id);

                // If this submission has already been emitted in a terminal state (non-TESTING), ignore on subsequent ticks
                if (lastVerdict && lastVerdict !== 'TESTING') {
                  continue;
                }

                const subPayload = {
                  roomCode: room.roomCode,
                  submissionId: sub.id,
                  id: sub.id,
                  handle: player.cfHandle,
                  verdict: sub.verdict,
                  passedTestCount: sub.passedTestCount || 0,
                  time: sub.creationTimeSeconds
                };

                // Hydrate in-memory room submissions history
                if (typeof room.addSubmission === 'function') {
                  room.addSubmission(subPayload);
                } else if (Array.isArray(room.submissions)) {
                  const existingIdx = room.submissions.findIndex(s => s.id === sub.id || s.submissionId === sub.id);
                  if (existingIdx >= 0) {
                    room.submissions[existingIdx] = { ...room.submissions[existingIdx], ...subPayload };
                  } else {
                    room.submissions.push(subPayload);
                  }
                }

                // Check if solution is ACCEPTED ("OK")
                if (sub.verdict === 'OK') {
                  room.processedSubmissions.set(sub.id, 'OK');
                  this.processedSubmissions.set(sub.id, 'OK');

                  // Emit real-time verdict check so the terminal displays the OK verdict
                  if (this.io) {
                    this.io.to(room.roomCode).emit('duel:cf_verdict_check', subPayload);
                  }

                  // Instant Victory Resolution
                  const resolution = await duelService.resolveMatch(
                    room.roomCode,
                    player.id,
                    'ACCEPTED_SUBMISSION'
                  );

                  if (this.io) {
                    const winPayload = {
                      roomCode: room.roomCode,
                      winnerId: player.id,
                      winnerHandle: player.cfHandle,
                      reason: 'ACCEPTED_SUBMISSION',
                      isDraw: false,
                      endedAt: new Date().toISOString(),
                      submissionId: sub.id,
                      userStats: resolution ? {
                        winner: resolution.winner,
                        loser: resolution.loser
                      } : null
                    };

                    this.io.to(room.roomCode).emit('duel:ended', winPayload);
                    this.io.to(room.roomCode).emit('room:state_update', room.toDTO());
                  }

                  // Room is now FINISHED
                  break;
                } else {
                  // Record latest non-terminal or terminal verdict
                  room.processedSubmissions.set(sub.id, sub.verdict);
                  this.processedSubmissions.set(sub.id, sub.verdict);

                  // Real-time Feedback: Emitted during TESTING or once upon transition to terminal state (e.g. COMPILATION_ERROR, WRONG_ANSWER)
                  if (this.io) {
                    this.io.to(room.roomCode).emit('duel:cf_verdict_check', subPayload);
                  }
                }
              }
            }
          } catch (cfErr) {
            // Gracefully catch CF network blips/503/500 without crashing
            console.warn(`[POLLEVER WARNING] CF status check failed for handle "${player.cfHandle}": ${cfErr.message}`);
          }
        }
      }
    } finally {
      this.isPolling = false;
    }
  }
}

const schedulerInstance = new VerificationScheduler();

module.exports = {
  verificationScheduler: schedulerInstance,
  startVerificationScheduler: (io, interval) => schedulerInstance.startVerificationScheduler(io, interval),
  stopVerificationScheduler: () => schedulerInstance.stopVerificationScheduler()
};

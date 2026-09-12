/**
 * Verification Cache & Problem Pool
 * Manages in-memory transient registration states for email OTP and Codeforces verification.
 */

// 20 valid, established, older Codeforces problems for verification submissions
const PROBLEM_POOL = [
  { contestId: 1108, index: 'B' }, // Divisors of Two Integers
  { contestId: 1324, index: 'A' }, // Yet Another Tetris Problem
  { contestId: 1472, index: 'C' }, // Long Jumps
  { contestId: 1097, index: 'A' }, // Gennady and a Card Game
  { contestId: 1206, index: 'B' }, // Make Product Equal One
  { contestId: 1352, index: 'C' }, // K-th Not Divisible by n
  { contestId: 1367, index: 'B' }, // Even Array
  { contestId: 1374, index: 'C' }, // Move Brackets
  { contestId: 1385, index: 'B' }, // Restore the Permutation by Merger
  { contestId: 1399, index: 'B' }, // Gifts Fixing
  { contestId: 1409, index: 'B' }, // Minimum Product
  { contestId: 1426, index: 'B' }, // Symmetric Matrix
  { contestId: 1433, index: 'C' }, // Dominant Piranha
  { contestId: 1454, index: 'B' }, // Unique Bid Auction
  { contestId: 1475, index: 'B' }, // New Year's Number
  { contestId: 1512, index: 'B' }, // Almost Rectangle
  { contestId: 1520, index: 'C' }, // Not Adjacent Matrix
  { contestId: 1535, index: 'B' }, // Array Reodering
  { contestId: 1547, index: 'B' }, // Alphabetical Strings
  { contestId: 1560, index: 'C' }  // Infinity Table
];

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache for pending registrations
const cache = new Map();

/**
 * Normalizes an email address to ensure consistent lookup keys.
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Returns a random problem from the curated PROBLEM_POOL.
 * @returns {{ contestId: number, index: string }}
 */
function getRandomProblem() {
  const randomIndex = Math.floor(Math.random() * PROBLEM_POOL.length);
  return { ...PROBLEM_POOL[randomIndex] };
}

/**
 * Stores pending registration data in the cache with a 10-minute expiration.
 * @param {string} email - User email address
 * @param {object} data - Registration payload
 * @param {string} data.passwordHash
 * @param {string} data.cfHandle
 * @param {string} data.otp
 * @param {number} data.targetContestId
 * @param {string} data.targetProblemIndex
 * @param {boolean} [data.isCfVerified=false]
 * @returns {object} The cached registration object
 */
function setPendingRegistration(email, data) {
  const key = normalizeEmail(email);
  if (!key) throw new Error('Invalid email provided for pending registration.');

  const entry = {
    passwordHash: data.passwordHash,
    cfHandle: data.cfHandle,
    otp: String(data.otp),
    targetContestId: Number(data.targetContestId),
    targetProblemIndex: String(data.targetProblemIndex),
    isCfVerified: Boolean(data.isCfVerified),
    expiresAt: Date.now() + TTL_MS
  };

  cache.set(key, entry);
  return entry;
}

/**
 * Retrieves a pending registration from the cache.
 * Purges and returns null if the entry has expired.
 * @param {string} email
 * @returns {object|null}
 */
function getPendingRegistration(email) {
  const key = normalizeEmail(email);
  if (!key) return null;

  const entry = cache.get(key);
  if (!entry) return null;

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry;
}

/**
 * Marks Codeforces handle as verified for the given email if existing and not expired.
 * @param {string} email
 * @returns {boolean} True if marked verified, false if not found or expired
 */
function markCfVerified(email) {
  const entry = getPendingRegistration(email);
  if (!entry) return false;

  entry.isCfVerified = true;
  return true;
}

/**
 * Deletes a pending registration entry from the cache.
 * @param {string} email
 * @returns {boolean} True if an element was removed, false otherwise
 */
function deletePendingRegistration(email) {
  const key = normalizeEmail(email);
  if (!key) return false;
  return cache.delete(key);
}

// Background cleanup timer to purge stale/expired records every 5 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt && now > entry.expiresAt) {
      cache.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Allow Node process to exit gracefully without timer keeping event loop open
if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

module.exports = {
  PROBLEM_POOL,
  cache,
  getRandomProblem,
  setPendingRegistration,
  getPendingRegistration,
  markCfVerified,
  deletePendingRegistration
};

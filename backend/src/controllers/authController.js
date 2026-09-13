const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');
const { sendOTP } = require('../services/emailService');
const {
  getRandomProblem,
  setPendingRegistration,
  getPendingRegistration,
  markCfVerified,
  deletePendingRegistration
} = require('../utils/verificationCache');

const JWT_EXPIRES_IN = '7d';

/**
 * STEP 1: Registration initiation
 * Validates availability, stores transient registration in cache, and emails verification OTP.
 */
async function registerStep1(req, res) {
  try {
    const { email, password, cfHandle, username } = req.body;

    if (!email || !password || !cfHandle) {
      return res.status(400).json({ error: 'Email, password, and Codeforces handle are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanCfHandle = cfHandle.trim();
    const chosenUsername = (username || cleanCfHandle).trim();

    // Check if user already exists in PostgreSQL database
    const existing = await db.query(
      'SELECT id, username, email FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2 OR LOWER(cf_handle) = $3',
      [normalizedEmail, chosenUsername.toLowerCase(), cleanCfHandle.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      const match = existing.rows[0];
      if (match.email.toLowerCase() === normalizedEmail) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      return res.status(409).json({ error: 'This username or Codeforces handle is already registered.' });
    }

    // Generate 6-digit random numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Pick random target problem from curated pool
    const targetProblem = getRandomProblem();

    // Hash password securely
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Store in transient verification cache (10 min TTL)
    setPendingRegistration(normalizedEmail, {
      username: chosenUsername,
      passwordHash,
      cfHandle: cleanCfHandle,
      otp,
      targetContestId: targetProblem.contestId,
      targetProblemIndex: targetProblem.index,
      isCfVerified: false
    });

    // Send email with OTP via nodemailer
    await sendOTP(normalizedEmail, otp);

    return res.status(200).json({
      message: 'Verification OTP sent to email and verification problem assigned.',
      targetContestId: targetProblem.contestId,
      targetProblemIndex: targetProblem.index
    });
  } catch (err) {
    console.error('[AUTH REGISTER-STEP1 ERROR]:', err);
    return res.status(500).json({ error: err.message || 'Internal server error during registration step 1.' });
  }
}

/**
 * STEP 2: Codeforces handle ownership verification
 * Inspects the last 5 submissions of the user for a COMPILATION_ERROR on the assigned problem within the last 5 minutes.
 */
async function verifyCf(req, res) {
  try {
    const { email, cfHandle } = req.body;

    if (!email || !cfHandle) {
      return res.status(400).json({ error: 'Email and Codeforces handle are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanCfHandle = cfHandle.trim();

    // Retrieve pending registration session
    const pending = getPendingRegistration(normalizedEmail);
    if (!pending) {
      return res.status(400).json({ error: 'Registration session expired or not found. Please restart registration.' });
    }

    if (pending.cfHandle.toLowerCase() !== cleanCfHandle.toLowerCase()) {
      return res.status(400).json({ error: 'Codeforces handle does not match the pending registration session.' });
    }

    // Fetch latest submissions from Codeforces public REST API
    const cfUrl = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(cleanCfHandle)}&from=1&count=5`;
    const cfResponse = await fetch(cfUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DevDuel-Platform/1.0'
      }
    });

    const cfData = await cfResponse.json().catch(() => null);

    if (!cfResponse.ok || cfData?.status !== 'OK' || !Array.isArray(cfData?.result)) {
      const errorMsg = cfData?.comment || `Failed to fetch Codeforces activity for ${cleanCfHandle}`;
      return res.status(400).json({ error: errorMsg });
    }

    // Must have been submitted within the last 5 minutes (300 seconds)
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;

    const hasValidSubmission = cfData.result.some(sub => {
      const contestMatch = Number(sub.problem?.contestId) === Number(pending.targetContestId);
      const indexMatch = String(sub.problem?.index).toUpperCase() === String(pending.targetProblemIndex).toUpperCase();
      const verdictMatch = sub.verdict === 'COMPILATION_ERROR';
      const timeMatch = Number(sub.creationTimeSeconds) >= fiveMinutesAgo;
      return contestMatch && indexMatch && verdictMatch && timeMatch;
    });

    if (!hasValidSubmission) {
      return res.status(400).json({
        error: `No recent COMPILATION_ERROR submission found on Contest ${pending.targetContestId}, Problem ${pending.targetProblemIndex} within the last 5 minutes. Please submit and try again.`
      });
    }

    // Mark verified in cache
    markCfVerified(normalizedEmail);

    return res.status(200).json({
      success: true,
      message: 'Codeforces account verified successfully.'
    });
  } catch (err) {
    console.error('[AUTH VERIFY-CF ERROR]:', err);
    return res.status(500).json({ error: err.message || 'Internal server error during Codeforces verification.' });
  }
}

/**
 * STEP 3: Final registration completion
 * Validates email OTP, verifies CF verification status, persists user to PostgreSQL, and issues 7d JWT.
 */
async function registerFinal(req, res) {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and verification OTP are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pending = getPendingRegistration(normalizedEmail);

    if (!pending) {
      return res.status(400).json({ error: 'Registration session expired or not found. Please restart registration.' });
    }

    // Validate OTP
    if (String(pending.otp).trim() !== String(otp).trim()) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    // Validate Codeforces verification
    if (!pending.isCfVerified) {
      return res.status(400).json({ error: 'Codeforces account has not been verified yet.' });
    }

    // Insert user into PostgreSQL
    const username = pending.username || pending.cfHandle;
    const result = await db.query(
      `INSERT INTO users (username, email, password_hash, cf_handle) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, username, email, cf_handle, wins, losses, draws, matches_played, created_at`,
      [username.trim(), normalizedEmail, pending.passwordHash, pending.cfHandle.trim()]
    );

    const user = result.rows[0];

    // Purge entry from temporary cache
    deletePendingRegistration(normalizedEmail);

    // Generate JWT with 7d expiration
    const token = jwt.sign(
      { userId: user.id, username: user.username, cfHandle: user.cf_handle },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'User registered and verified successfully.',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        cfHandle: user.cf_handle,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        matchesPlayed: user.matches_played,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    console.error('[AUTH REGISTER-FINAL ERROR]:', err);
    return res.status(500).json({ error: err.message || 'Internal server error during final registration.' });
  }
}

/**
 * Authenticate existing user and issue 7-day JWT
 */
async function login(req, res) {
  try {
    const { identifier, email, username, password } = req.body;
    const loginIdentifier = (identifier || email || username || '').trim().toLowerCase();

    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: 'Username/email and password are required.' });
    }

    // Find user by email or username
    const result = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1',
      [loginIdentifier]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    const user = result.rows[0];

    // Verify bcrypt password hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    // Issue JWT with 7d expiration
    const token = jwt.sign(
      { userId: user.id, username: user.username, cfHandle: user.cf_handle },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const winRate = user.matches_played === 0 
      ? 0 
      : Number(((user.wins / user.matches_played) * 100).toFixed(1));

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        cfHandle: user.cf_handle,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        matchesPlayed: user.matches_played,
        winRate,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    console.error('[AUTH LOGIN ERROR]:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
}

/**
 * Backward-compatible single-step register endpoint
 */
async function register(req, res) {
  try {
    const { username, email, password, cfHandle } = req.body;

    const existing = await db.query(
      'SELECT id, username, email FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase().trim(), username.trim()]
    );

    if (existing.rows.length > 0) {
      const match = existing.rows[0];
      if (match.email.toLowerCase() === email.toLowerCase().trim()) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      return res.status(409).json({ error: 'This username is already taken.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await db.query(
      `INSERT INTO users (username, email, password_hash, cf_handle) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, username, email, cf_handle, wins, losses, draws, matches_played, created_at`,
      [username.trim(), email.toLowerCase().trim(), passwordHash, cfHandle.trim()]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, username: user.username, cfHandle: user.cf_handle },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        cfHandle: user.cf_handle,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        matchesPlayed: user.matches_played,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    console.error('[AUTH REGISTER ERROR]:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
}

/**
 * Get profile of currently authenticated user
 */
async function getMe(req, res) {
  try {
    const user = req.user;
    const winRate = user.matches_played === 0 
      ? 0 
      : Number(((user.wins / user.matches_played) * 100).toFixed(1));

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        cfHandle: user.cf_handle,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        matchesPlayed: user.matches_played,
        winRate,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    console.error('[AUTH GET_ME ERROR]:', err);
    return res.status(500).json({ error: 'Failed to retrieve user profile.' });
  }
}

module.exports = {
  registerStep1,
  verifyCf,
  registerFinal,
  login,
  register,
  getMe
};

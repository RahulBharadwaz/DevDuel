const jwt = require('jsonwebtoken');
const db = require('../config/db');

const DEFAULT_DEV_SECRET = 'devduel_jwt_secret_dev_key_2026_super_secure';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_DEV_SECRET;

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_DEV_SECRET)) {
  console.warn('[SECURITY CRITICAL] Insecure or default JWT_SECRET used in production environment.');
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verify user exists in database
    const result = await db.query(
      'SELECT id, username, email, cf_handle, wins, losses, draws, matches_played, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token: User no longer exists.' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(403).json({ error: 'Invalid authentication token.' });
  }
}

module.exports = {
  authenticateToken,
  JWT_SECRET
};

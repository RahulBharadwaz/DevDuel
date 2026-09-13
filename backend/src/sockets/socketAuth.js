const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'devduel_jwt_secret_dev_key_2026_super_secure';

/**
 * Socket.IO authentication middleware.
 * Intercepts connection, validates JWT, and attaches user identity to socket.data.user.
 */
function socketAuth(socket, next) {
  try {
    // Extract token from handshake auth or authorization header
    let token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;

    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    // Strip 'Bearer ' prefix if present
    if (typeof token === 'string' && token.startsWith('Bearer ')) {
      token = token.slice(7).trim();
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded || !decoded.userId) {
      return next(new Error('Authentication error: Malformed token payload'));
    }

    // Attach authenticated identity to socket session
    socket.data.user = {
      id: decoded.userId,
      userId: decoded.userId,
      username: decoded.username,
      cfHandle: decoded.cfHandle || decoded.username
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new Error('Authentication error: Token expired'));
    }
    return next(new Error('Authentication error: Invalid token'));
  }
}

module.exports = socketAuth;

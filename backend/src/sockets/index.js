const { Server } = require('socket.io');
const socketAuth = require('./socketAuth');
const registerRoomHandlers = require('./roomHandlers');
const registerDuelHandlers = require('./duelHandlers');

/**
 * Initializes and binds the Socket.IO server to the native Node HTTP server
 * @param {import('http').Server} httpServer 
 * @param {object} [customOptions={}]
 * @returns {Server}
 */
function initSocketServer(httpServer, customOptions = {}) {
  const allowedOrigin = process.env.CLIENT_URL || 'http://localhost:5173';

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigin,
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingInterval: 10000,
    pingTimeout: 5000,
    ...customOptions
  });

  // Attach JWT authentication middleware to socket handshake
  io.use(socketAuth);

  // Register event listeners on successful connection
  io.on('connection', (socket) => {
    registerRoomHandlers(io, socket);
    registerDuelHandlers(io, socket);
  });

  return io;
}

module.exports = { initSocketServer };

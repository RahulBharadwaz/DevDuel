const http = require('http');
const dotenv = require('dotenv');
dotenv.config();

const app = require('./app');
const { initSocketServer } = require('./sockets');
const { startVerificationScheduler, stopVerificationScheduler } = require('./services/verificationScheduler');

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.IO Gateway
const io = initSocketServer(server);

// Start Central Background Codeforces Verification Poller
startVerificationScheduler(io);

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`  DevDuel Backend Server Online          `);
  console.log(`  Port: ${PORT}                          `);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Health Check: http://localhost:${PORT}/api/health`);
  console.log(`  Verification Poller: ACTIVE (5s cycle) `);
  console.log(`=========================================`);
});

// Graceful process shutdown
function handleShutdown(signal) {
  console.log(`\n[SERVER] Received ${signal}. Commencing graceful shutdown...`);
  stopVerificationScheduler();
  io.close(() => {
    server.close(() => {
      console.log('[SERVER] Server and WebSockets successfully terminated.');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = { app, server, io };

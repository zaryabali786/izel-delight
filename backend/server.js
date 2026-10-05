require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const { initRealtime } = require('./src/services/realtime.service');
const { CacheService } = require('./src/config/redis');

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.io Realtime Service
initRealtime(server);

server.listen(PORT, () => {
  console.log('─────────────────────────────────────────');
  console.log(`🚀  Server running on port ${PORT}`);
  console.log(`🌍  Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`⚡  Cache Driver : ${CacheService.isRedisLive() ? 'Redis' : 'In-Memory (High-Speed Fallback)'}`);
  console.log(`📡  Base URL    : http://localhost:${PORT}`);
  console.log(`🔐  Auth routes : http://localhost:${PORT}/api/auth`);
  console.log(`🏪  Store routes: http://localhost:${PORT}/api/stores`);
  console.log(`🛍️   Shopify     : http://localhost:${PORT}/api/shopify`);
  console.log(`🔌  Integrations: http://localhost:${PORT}/api/integrations`);
  console.log(`⚡  Realtime WS : ws://localhost:${PORT}`);
  console.log(`❤️   Health      : http://localhost:${PORT}/health`);
  console.log('─────────────────────────────────────────');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Rejection:', err.message);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message);
  process.exit(1);
});

module.exports = server;

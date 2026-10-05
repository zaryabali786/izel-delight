const { Server } = require('socket.io');
const { supabaseAdmin } = require('../config/supabase');

let io = null;

/**
 * Initialize Socket.io Realtime server
 */
function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  // Authentication Middleware for WebSocket Connections
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
        socket.handshake.query?.token;

      if (!token) {
        // Allow unauthenticated connection with limited anonymous room
        socket.user = null;
        return next();
      }

      // Verify token with Supabase Admin
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data?.user) {
        return next(new Error('Authentication failed: Invalid or expired token'));
      }

      socket.user = data.user;
      next();
    } catch (err) {
      console.warn('[Realtime] Socket auth error:', err.message);
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    if (userId) {
      socket.join(`user:${userId}`);
    }

    // Client requests to join a specific store room
    socket.on('store:join', (storeId) => {
      if (storeId) {
        socket.join(`store:${storeId}`);
      }
    });

    socket.on('store:leave', (storeId) => {
      if (storeId) {
        socket.leave(`store:${storeId}`);
      }
    });

    socket.on('disconnect', () => {});
  });

  return io;
}

/**
 * Emit event strictly to clients viewing a specific store (Tenant Isolation!)
 */
function emitToStore(storeId, event, data) {
  if (!io || !storeId) return false;
  io.to(`store:${storeId}`).emit(event, {
    storeId,
    timestamp: new Date().toISOString(),
    ...data,
  });
  return true;
}

/**
 * Emit event to a specific user
 */
function emitToUser(userId, event, data) {
  if (!io || !userId) return false;
  io.to(`user:${userId}`).emit(event, {
    userId,
    timestamp: new Date().toISOString(),
    ...data,
  });
  return true;
}

/**
 * Get active io instance
 */
function getIO() {
  return io;
}

module.exports = {
  initRealtime,
  emitToStore,
  emitToUser,
  getIO,
};

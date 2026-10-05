require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

// ─── Cache & Performance Imports ─────────────────────────────────
const { CacheService } = require('./config/redis');
const { apiLimiter } = require('./middleware/rateLimit.middleware');

// ─── Route Imports ───────────────────────────────────────────────
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const storeRoutes = require('./routes/store.routes');
const shopifyRoutes = require('./routes/shopify.routes');
const integrationsRoutes = require('./routes/integrations.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const ordersRoutes = require('./routes/orders.routes');
const aiRoutes = require('./routes/ai.routes');

// ─── Middleware Imports ──────────────────────────────────────────
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');

// ─── App Setup ───────────────────────────────────────────────────
const app = express();

// Trust reverse proxies (Cloudflare, Nginx, AWS ALB, Vercel)
app.set('trust proxy', 1);

// ─── High-Traffic Performance & Security Middleware ──────────────
app.use(helmet()); // Security headers
app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// High-speed response compression (Gzip / Deflate)
app.use(
  compression({
    threshold: 1024, // Only compress responses larger than 1KB
    level: 6,
  })
);

// Preserve raw body buffer for Shopify webhook HMAC verification
app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logger ──────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
}

// ─── Global Health Check & Performance Telemetry ─────────────────
app.get('/health', async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is healthy and running.',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    cache: {
      enabled: CacheService.isEnabled(),
      driver: CacheService.isRedisLive() ? 'redis' : 'in-memory (high-speed fallback)',
      status: CacheService.isRedisLive() ? 'connected' : 'memory-active',
    },
    system: {
      uptime_seconds: Math.floor(process.uptime()),
      memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
  });
});

// ─── Rate Limiter applied to API routes ──────────────────────────
app.use('/api', apiLimiter);

// ─── API Routes ──────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/ai', aiRoutes);

// ─── 404 & Error Handlers (must be LAST) ─────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

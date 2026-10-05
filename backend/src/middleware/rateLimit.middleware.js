const rateLimit = require('express-rate-limit');

/**
 * Strict Rate Limiter for Authentication endpoints
 * Protects against brute-force attacks and credential stuffing
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 auth requests per windowMs
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login/signup attempts from this IP. Please try again after 15 minutes.',
  },
});

/**
 * General API Rate Limiter
 * Protects server from traffic spikes, DDoS, and runaway client polling
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'High traffic threshold reached. Please slow down your requests.',
  },
});

module.exports = { authLimiter, apiLimiter };

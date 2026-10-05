const express = require('express');
const router = express.Router();

const {
  signup,
  verifyEmail,
  resendVerification,
  login,
  logout,
  getMe,
  refreshToken,
  forgotPassword,
  updatePassword,
} = require('../controllers/auth.controller');

const { authMiddleware } = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimit.middleware');

// ─── Public Routes (Rate-limited against brute force & bot spam) ──
// @route   POST /api/auth/signup
router.post('/signup', authLimiter, signup);

// @route   GET|POST /api/auth/verify-email
router.get('/verify-email', verifyEmail);
router.post('/verify-email', verifyEmail);

// @route   POST /api/auth/resend-verification
router.post('/resend-verification', authLimiter, resendVerification);

// @route   POST /api/auth/login
router.post('/login', authLimiter, login);

// @route   POST /api/auth/refresh
router.post('/refresh', authLimiter, refreshToken);

// @route   POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, forgotPassword);

// ─── Protected Routes (require valid JWT) ───────────────────────
// @route   GET /api/auth/me
router.get('/me', authMiddleware, getMe);

// @route   POST /api/auth/logout
router.post('/logout', authMiddleware, logout);

// @route   PUT /api/auth/update-password
router.put('/update-password', authMiddleware, updatePassword);

module.exports = router;

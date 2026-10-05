const { supabaseAdmin } = require('../config/supabase');

/**
 * Authentication Middleware
 * Verifies the Supabase JWT token from the Authorization header.
 * Attaches the authenticated user to req.user on success.
 *
 * Usage: add `authMiddleware` to any route that needs protection.
 *
 * Header format: Authorization: Bearer <access_token>
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided or invalid format.',
        hint: 'Send: Authorization: Bearer <your_access_token>',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Token is empty.',
      });
    }

    // Verify token using Supabase Admin client
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token. Please login again.',
        error: error?.message || 'Token verification failed',
      });
    }

    // Attach authenticated user to request object
    req.user = data.user;
    req.token = token;

    next();
  } catch (err) {
    console.error('[AuthMiddleware] Error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
    });
  }
};

/**
 * Optional Auth Middleware
 * Like authMiddleware but does NOT block the request if no token.
 * Useful for routes where auth is optional (e.g., public feed with user-specific behavior).
 */
const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      req.user = null;
      return next();
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    req.user = error || !data?.user ? null : data.user;
    req.token = token;

    next();
  } catch (err) {
    console.error('[OptionalAuthMiddleware] Error:', err.message);
    req.user = null;
    next();
  }
};

module.exports = {
  authMiddleware,
  verifyAuth: authMiddleware,
  optionalAuthMiddleware,
};

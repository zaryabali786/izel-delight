const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');

// ─── Example Protected User Routes ──────────────────────────────
// @desc  Get logged-in user's profile info (example usage of authMiddleware)
// @route GET /api/user/profile
router.get('/profile', authMiddleware, (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Protected route accessed successfully.',
    data: {
      user: {
        id: req.user.id,
        email: req.user.email,
        full_name: req.user.user_metadata?.full_name,
      },
    },
  });
});

// Add more protected user routes here...

module.exports = router;

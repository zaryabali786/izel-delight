const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyAuth } = require('../middleware/auth.middleware');
const C = require('../controllers/ai-settings.controller');

const router = express.Router();
router.use(verifyAuth);

// The test box calls the language model, so keep it modest.
const testLimiter = rateLimit({ windowMs: 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many tests. Please wait a minute.' } });

router.get('/:storeId', C.get);
router.put('/:storeId', C.update);
router.post('/:storeId/test', testLimiter, C.test);

module.exports = router;

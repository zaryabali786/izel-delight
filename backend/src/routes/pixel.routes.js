const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Attribution = require('../services/marketing/attribution');

const router = express.Router();

// Public by design: it is called from any customer storefront. Authorization is the per-store
// pixel key, and these routes only ever WRITE analytics events or serve the script.
router.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
router.use((req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

const collectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false },
});

// sendBeacon posts text/plain; accept JSON in either content type.
router.post('/collect', collectLimiter, express.text({ type: '*/*', limit: '64kb' }), (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const storeId = Attribution.storeIdForPixelKey(String(body.key || ''));
    if (!storeId) return res.status(204).end(); // never reveal whether a key exists
    Attribution.ingest(storeId, Array.isArray(body.events) ? body.events : []);
    return res.status(204).end();
  } catch (_) {
    return res.status(204).end();
  }
});

router.get('/:key.js', (req, res) => {
  const key = String(req.params.key);
  if (!Attribution.storeIdForPixelKey(key)) return res.status(404).type('text/plain').send('/* unknown pixel */');
  const base = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
  res.type('application/javascript').set('Cache-Control', 'public, max-age=300').send(Attribution.pixelScript(key, `${base}/api/pixel/collect`));
});

module.exports = router;

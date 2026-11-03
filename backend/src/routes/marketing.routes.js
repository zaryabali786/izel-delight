const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyAuth } = require('../middleware/auth.middleware');
const C = require('../controllers/marketing.controller');

const router = express.Router();
router.use(verifyAuth);

// The AI analyst calls OpenAI several times per question, so cap it tighter than the general limiter.
const askLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many questions. Please wait a minute.' } });

router.get('/:storeId/blended', C.blended);
router.get('/:storeId/channels', C.channels);
router.get('/:storeId/cohorts', C.cohorts);
router.get('/:storeId/rfm', C.rfm);
router.get('/:storeId/products', C.products);
router.get('/:storeId/alerts', C.alerts);

router.get('/:storeId/ad-spend', C.listAdSpend);
router.post('/:storeId/ad-spend', C.importAdSpend);
router.delete('/:storeId/ad-spend', C.clearAdSpend);
router.post('/:storeId/ad-spend/sync-meta', C.syncMeta);

router.get('/:storeId/pixel', C.getPixel);
router.post('/:storeId/pixel/rotate', C.rotatePixel);
router.get('/:storeId/attribution', C.attribution);
router.get('/:storeId/funnel', C.funnel);

router.get('/:storeId/experiments', C.listExperiments);
router.post('/:storeId/experiments', C.createExperiment);
router.get('/:storeId/experiments/suggest', C.suggestExperiment);
router.get('/:storeId/experiments/:id', C.analyzeExperiment);
router.delete('/:storeId/experiments/:id', C.deleteExperiment);

router.get('/:storeId/audiences', C.audiences);
router.get('/:storeId/audiences/:id/export', C.exportAudience);
router.post('/:storeId/audiences/:id/klaviyo', C.pushKlaviyo);
router.put('/:storeId/klaviyo', C.saveKlaviyo);
router.get('/:storeId/klaviyo/lists', C.klaviyoLists);
router.put('/:storeId/capi', C.saveCapi);
router.post('/:storeId/capi/send', C.sendCapi);

router.get('/:storeId/connectors', C.connectors);
router.post('/:storeId/ask', askLimiter, C.ask);

module.exports = router;

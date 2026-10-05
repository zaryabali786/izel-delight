const express = require('express');
const router = express.Router();
const AIController = require('../controllers/ai.controller');
const { verifyAuth } = require('../middleware/auth.middleware');

router.use(verifyAuth);

router.get('/:storeId/growth-insights', AIController.getGrowthInsights);
router.post('/:storeId/growth-insights', AIController.getGrowthInsights);
router.post('/:storeId/search', AIController.searchProducts);
router.get('/:storeId/prompt', AIController.getPrompt);
router.put('/:storeId/prompt', AIController.updatePrompt);

module.exports = router;

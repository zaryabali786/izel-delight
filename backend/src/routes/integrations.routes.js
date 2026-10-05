const express = require('express');
const router = express.Router();
const IntegrationsController = require('../controllers/integrations.controller');
const { verifyAuth } = require('../middleware/auth.middleware');

// All integration endpoints require authenticated session
router.use(verifyAuth);

// Get all integrations for a store
router.get('/:storeId', IntegrationsController.getIntegrations);

// Connect and verify integration
router.post('/connect', IntegrationsController.connectIntegration);

// Disconnect integration
router.post('/disconnect', IntegrationsController.disconnectIntegration);

// Test credentials against provider API
router.post('/test', IntegrationsController.testConnection);

// Trigger live sync for a store and provider
router.post('/sync', IntegrationsController.syncIntegration);

module.exports = router;

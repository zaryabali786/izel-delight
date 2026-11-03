const express = require('express');
const router = express.Router();
const SupportChannelsController = require('../controllers/support-channels.controller');
const { verifyAuth } = require('../middleware/auth.middleware');

// ── Public Webhook & OAuth Callback Endpoints ──────────────────────────────
router.get('/meta/webhook', SupportChannelsController.verifyMetaWebhook);
router.post('/meta/webhook', SupportChannelsController.handleMetaWebhook);

router.post('/email/inbound', SupportChannelsController.handleInboundEmail);
router.get('/meta/callback', SupportChannelsController.handleMetaCallback);

// ── Protected Store Endpoints ──────────────────────────────────────────────
router.use(verifyAuth);

router.post('/meta/register-webhooks', SupportChannelsController.registerMetaWebhooks);
router.get('/:storeId', SupportChannelsController.getChannels);
router.get('/:storeId/meta/oauth-url', SupportChannelsController.getMetaOAuthUrl);
router.post('/:storeId/email/connect', SupportChannelsController.connectEmailChannel);
router.post('/:storeId/:channelId/disconnect', SupportChannelsController.disconnectChannel);
router.post('/:storeId/:channelId/test', SupportChannelsController.testChannel);

module.exports = router;

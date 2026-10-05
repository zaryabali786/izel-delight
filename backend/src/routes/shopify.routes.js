const express = require('express');
const router = express.Router();
const ShopifyController = require('../controllers/shopify.controller');
const { verifyAuth } = require('../middleware/auth.middleware');

// ─── Public Shopify Webhook & OAuth Callbacks ──────────────────────────────
// Webhook notifications signed with X-Shopify-Hmac-Sha256
router.post('/webhooks/:topic', ShopifyController.handleWebhook);
router.post('/webhooks', ShopifyController.handleWebhook);

// OAuth redirect endpoint after merchant installs app in Shopify Admin
router.get('/callback', ShopifyController.handleCallback);

// ─── Protected Authenticated Store Endpoints (Require Bearer JWT) ─────────
router.use(verifyAuth);

// Generate OAuth URL
router.get('/auth-url', ShopifyController.getAuthUrl);

// Direct Custom App / Private Token Connect (shpat_...)
router.post('/connect-token', ShopifyController.connectToken);

// Disconnect integration
router.post('/disconnect', ShopifyController.disconnect);

// Trigger full catalog sync
router.post('/sync/:storeId', ShopifyController.triggerSync);

// Push product update to Shopify Admin API (Bidirectional sync)
router.put('/products/:storeId/:productId', ShopifyController.updateProduct);

module.exports = router;

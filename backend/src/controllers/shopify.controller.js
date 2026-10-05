const ShopifyService = require('../services/shopify.service');
const StoreService = require('../services/store.service');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8100';

const ShopifyController = {
  /**
   * 1. GET /api/shopify/auth-url
   * Generate official Shopify OAuth authorization URL
   */
  async getAuthUrl(req, res, next) {
    try {
      const { shop, storeId } = req.query;
      if (!shop || !storeId) {
        return res.status(400).json({
          success: false,
          error: 'Parameters "shop" and "storeId" are required.',
        });
      }

      // Validate tenant store ownership
      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Store does not belong to your account.',
        });
      }

      const authUrl = ShopifyService.generateAuthUrl(shop, storeId, req.user.id);
      return res.status(200).json({
        success: true,
        authUrl,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 2. GET /api/shopify/callback
   * Shopify OAuth redirect handler
   */
  async handleCallback(req, res, next) {
    try {
      const { shop, code, state, hmac } = req.query;

      if (!shop || !code || !state) {
        return res.redirect(`${FRONTEND_URL}/dashboard?shopify_error=missing_params`);
      }

      const result = await ShopifyService.handleOAuthCallback({
        shop,
        code,
        state,
        hmac,
        query: req.query,
      });

      return res.redirect(
        `${FRONTEND_URL}/dashboard?shopify=connected&shop=${encodeURIComponent(result.shop)}&storeId=${result.storeId}`
      );
    } catch (err) {
      console.error('[ShopifyController] OAuth callback error:', err.message);
      return res.redirect(`${FRONTEND_URL}/dashboard?shopify_error=${encodeURIComponent(err.message)}`);
    }
  },

  /**
   * 3. POST /api/shopify/connect-token
   * Direct Custom/Private App Access Token (shpat_...) verification & connect
   */
  async connectToken(req, res, next) {
    try {
      const { storeId, shopDomain, accessToken } = req.body;

      if (!storeId || !shopDomain || !accessToken) {
        return res.status(400).json({
          success: false,
          error: 'Fields "storeId", "shopDomain", and "accessToken" are required.',
        });
      }

      // Validate tenant store ownership
      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Store does not belong to your account.',
        });
      }

      const result = await ShopifyService.verifyAndConnectToken(
        storeId,
        req.user.id,
        shopDomain,
        accessToken
      );

      return res.status(200).json({
        success: true,
        message: 'Shopify credentials verified and connected successfully. Full catalog sync initiated.',
        store: result,
      });
    } catch (err) {
      const status = err.response?.status === 401 || err.response?.status === 404 ? 400 : 500;
      return res.status(status).json({
        success: false,
        error: err.response?.data?.errors || err.message || 'Failed to authenticate with Shopify.',
      });
    }
  },

  /**
   * 4. POST /api/shopify/disconnect
   * Disconnect Shopify for a store
   */
  async disconnect(req, res, next) {
    try {
      const { storeId } = req.body;
      if (!storeId) {
        return res.status(400).json({
          success: false,
          error: 'Parameter "storeId" is required.',
        });
      }

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Store does not belong to your account.',
        });
      }

      await ShopifyService.disconnectStore(storeId, req.user.id);
      return res.status(200).json({
        success: true,
        message: 'Shopify store disconnected successfully.',
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 5. POST /api/shopify/sync/:storeId
   * Trigger full catalog sync
   */
  async triggerSync(req, res, next) {
    try {
      const { storeId } = req.params;

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Store does not belong to your account.',
        });
      }

      const creds = await ShopifyService.getDecryptedToken(storeId, req.user.id);
      if (!creds) {
        return res.status(400).json({
          success: false,
          error: 'Shopify is not connected for this store. Please connect credentials first.',
        });
      }

      // Execute sync in background
      ShopifyService.syncFullCatalog(storeId, creds.shop, creds.accessToken).catch((e) => {
        console.error('[ShopifyController] Background sync error:', e.message);
      });

      return res.status(202).json({
        success: true,
        message: 'Full catalog sync triggered. Live progress will be emitted via Realtime WebSockets.',
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 6. PUT /api/shopify/products/:storeId/:productId
   * Bidirectional sync: Push product edit to Shopify Admin API
   */
  async updateProduct(req, res, next) {
    try {
      const { storeId, productId } = req.params;

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Store does not belong to your account.',
        });
      }

      const updated = await ShopifyService.updateProductInShopify(
        storeId,
        req.user.id,
        productId,
        req.body
      );

      return res.status(200).json({
        success: true,
        product: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * 7. POST /api/shopify/webhooks/:topic
   * Public webhook endpoint from Shopify with cryptographic HMAC validation
   */
  async handleWebhook(req, res) {
    const topicHeader = req.headers['x-shopify-topic'] || req.params.topic;
    const shopDomain = req.headers['x-shopify-shop-domain'];
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    const webhookId = req.headers['x-shopify-webhook-id'];

    // Verify HMAC digital signature with raw unparsed body
    const isValid = ShopifyService.verifyWebhook(req.rawBody, hmacHeader);
    if (!isValid) {
      console.warn(`[ShopifyController] ❌ Rejected unauthorized webhook from ${shopDomain}: Invalid HMAC signature.`);
      return res.status(401).send('HMAC signature verification failed.');
    }

    // Acknowledge Shopify immediately (200 OK) to prevent webhook timeouts
    res.status(200).json({ received: true });

    // Process asynchronously with multi-tenant isolation
    ShopifyService.handleWebhookEvent({
      topic: topicHeader,
      shopDomain,
      webhookId,
      payload: req.body,
    }).catch((err) => {
      console.error('[ShopifyController] Error processing webhook event:', err.message);
    });
  },
};

module.exports = ShopifyController;

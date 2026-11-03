const SupportChannelsService = require('../services/support-channels.service');
const StoreService = require('../services/store.service');
const Connections = require('../services/oauth/connections');
const { isOperator } = require('../utils/operator');

/** The state is signed, not secret; reading the popup flag from it only changes how the result is displayed. */
function wantsPopup(state) {
  try {
    return !!JSON.parse(JSON.parse(Buffer.from(String(state), 'base64').toString('utf8')).payload).popup;
  } catch (_) {
    return false;
  }
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8100';

const SupportChannelsController = {
  /**
   * GET /api/support-channels/:storeId
   * List all support channels for store
   */
  async getChannels(req, res, next) {
    try {
      const { storeId } = req.params;

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({ success: false, error: 'Access denied: Store does not belong to your account.' });
      }

      let channels = await StoreService.getStoreSupportChannels(storeId);

      // Check if Shopify integration is active in store_integrations and ensure it appears as a support channel
      const integrations = await StoreService.getStoreIntegrations(storeId, req.user.id);
      const shopifyInt = integrations.find((i) => i.provider === 'shopify');
      const hasShopifyChannel = channels.some((c) => c.channel_type === 'shopify');

      if (shopifyInt && shopifyInt.status === 'connected' && !hasShopifyChannel) {
        const autoShopify = await StoreService.upsertSupportChannel(storeId, req.user.id, {
          channel_type: 'shopify',
          name: `Shopify: ${shopifyInt.config?.shop_name || shopifyInt.config?.shop_domain || 'Storefront'}`,
          account_id: shopifyInt.config?.shop_domain,
          status: 'connected',
          webhook_verified: !!shopifyInt.config?.webhook_active,
          settings: {
            domain: shopifyInt.config?.shop_domain,
            currency: shopifyInt.config?.currency || 'PKR',
            synced_products: shopifyInt.config?.synced_products || 0,
          },
        });
        channels.push(autoShopify);
      }

      return res.status(200).json({
        success: true,
        channels,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/support-channels/:storeId/meta/oauth-url
   * Get Meta OAuth Authorization URL
   */
  async getMetaOAuthUrl(req, res, next) {
    try {
      const { storeId } = req.params;

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({ success: false, error: 'Access denied: Store does not belong to your account.' });
      }

      const authUrl = SupportChannelsService.getMetaOAuthUrl(storeId, req.user.id);
      return res.status(200).json({ success: true, authUrl });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/support-channels/meta/callback
   * Meta OAuth Redirect Callback
   */
  async handleMetaCallback(req, res) {
    try {
      const { code, state, error, error_description } = req.query;

      if (error) {
        console.error('[SupportChannels] Meta OAuth error from provider:', error_description || error);
        if (wantsPopup(state)) return res.type('html').send(Connections.popupPage({ ok: false, provider: 'meta-messaging', message: error_description || String(error) }));
        return res.redirect(`${FRONTEND_URL}/dashboard/integrations?meta_error=${encodeURIComponent(error_description || error)}`);
      }

      if (!code || !state) {
        return res.redirect(`${FRONTEND_URL}/dashboard/integrations?meta_error=missing_oauth_params`);
      }

      const result = await SupportChannelsService.handleMetaOAuthCallback(code, state);

      if (result.popup) {
        const n = result.connectedChannels.length;
        return res.type('html').send(
          Connections.popupPage({ ok: true, provider: 'meta-messaging', message: n ? `${n} Facebook / Instagram account(s) connected.` : 'No Facebook Pages were shared. Reconnect and select your Page.' })
        );
      }
      return res.redirect(
        `${FRONTEND_URL}/dashboard/integrations?meta_oauth=success&storeId=${result.storeId}&pages=${result.pagesCount}`
      );
    } catch (err) {
      console.error('[SupportChannels] Meta OAuth callback handler error:', err.message);
      if (wantsPopup(req.query.state)) return res.type('html').send(Connections.popupPage({ ok: false, provider: 'meta-messaging', message: err.message }));
      return res.redirect(`${FRONTEND_URL}/dashboard/integrations?meta_error=${encodeURIComponent(err.message)}`);
    }
  },

  /**
   * POST /api/support-channels/:storeId/email/connect
   * Connect an Email Support Channel
   */
  async connectEmailChannel(req, res, next) {
    try {
      const { storeId } = req.params;
      const { email, displayName } = req.body;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Business email address is required.' });
      }

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      const channel = await SupportChannelsService.connectEmailChannel(storeId, req.user.id, email, displayName);

      return res.status(200).json({
        success: true,
        message: 'Email support channel configured successfully.',
        channel,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/support-channels/:storeId/:channelId/disconnect
   * Disconnect a channel
   */
  async disconnectChannel(req, res, next) {
    try {
      const { storeId, channelId } = req.params;

      const store = await StoreService.getStoreById(storeId, req.user.id);
      if (!store) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      const updated = await StoreService.updateSupportChannel(storeId, channelId, {
        status: 'disconnected',
        credentials_encrypted: null,
      });

      return res.status(200).json({
        success: true,
        message: 'Channel disconnected.',
        channel: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/support-channels/meta/register-webhooks  (operator only)
   * Subscribes the Meta app to Page and Instagram webhooks for this server's callback URL.
   */
  async registerMetaWebhooks(req, res, next) {
    try {
      if (!isOperator(req.user)) return res.status(403).json({ success: false, error: 'Only the platform operator can register webhooks.' });
      const out = await SupportChannelsService.registerMetaWebhooks();
      return res.status(200).json({ success: true, ...out });
    } catch (err) {
      if (err && err.message && !err.statusCode) return res.status(400).json({ success: false, error: err.message });
      next(err);
    }
  },

  /**
   * POST /api/support-channels/:storeId/:channelId/test
   * Test API handshake of a channel
   */
  async testChannel(req, res, next) {
    try {
      const { storeId, channelId } = req.params;

      const channel = await StoreService.getSupportChannelById(storeId, channelId);
      if (!channel) {
        return res.status(404).json({ success: false, error: 'Channel not found.' });
      }

      return res.status(200).json({
        success: true,
        channelType: channel.channel_type,
        status: channel.status,
        webhookVerified: channel.webhook_verified,
        message: 'Channel connection validated and active.',
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/support-channels/meta/webhook
   * Meta Webhook Hub Challenge
   */
  verifyMetaWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const response = SupportChannelsService.verifyMetaWebhook(mode, token, challenge);
    if (response) {
      return res.status(200).send(response);
    }
    return res.status(403).send('Forbidden');
  },

  /**
   * POST /api/support-channels/meta/webhook
   * Meta Webhook Events (Messenger, Instagram, Comments, Ad Comments)
   */
  async handleMetaWebhook(req, res) {
    const signature = req.headers['x-hub-signature-256'];
    res.status(200).send('EVENT_RECEIVED'); // Acknowledge immediately

    SupportChannelsService.handleMetaWebhookEvent(req.rawBody, signature, req.body).catch((err) => {
      console.error('[SupportChannels] Webhook event error:', err.message);
    });
  },

  /**
   * POST /api/support-channels/email/inbound
   * Inbound email webhook endpoint
   */
  async handleInboundEmail(req, res) {
    // The provider (Mailgun / SendGrid / Postmark route) must send the shared secret, so strangers cannot inject mail.
    const secret = process.env.INBOUND_EMAIL_SECRET;
    const given = req.headers['x-webhook-secret'] || req.query.secret;
    if (secret ? given !== secret : process.env.NODE_ENV === 'production') {
      return res.status(403).json({ received: false, error: 'Invalid or missing webhook secret.' });
    }
    res.status(200).json({ received: true });

    SupportChannelsService.handleInboundEmail(req.body).catch((err) => {
      console.error('[SupportChannels] Inbound email error:', err.message);
    });
  },
};

module.exports = SupportChannelsController;

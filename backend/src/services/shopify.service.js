const axios = require('axios');
const crypto = require('crypto');
const { encrypt, decrypt, verifyHmacSha256 } = require('../utils/crypto');
const { emitToStore } = require('./realtime.service');
const StoreService = require('./store.service');
const AIService = require('./ai.service');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '';
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8100';

// In-memory idempotency cache for processed webhook IDs (expires in 1 hour)
const processedWebhooks = new Map();

function isWebhookProcessed(webhookId) {
  if (!webhookId) return false;
  const processedAt = processedWebhooks.get(webhookId);
  if (processedAt && Date.now() - processedAt < 3600000) {
    return true;
  }
  processedWebhooks.set(webhookId, Date.now());
  // Cleanup old entries
  if (processedWebhooks.size > 5000) {
    const cutoff = Date.now() - 3600000;
    for (const [id, time] of processedWebhooks.entries()) {
      if (time < cutoff) processedWebhooks.delete(id);
    }
  }
  return false;
}

/**
 * Standardize shop domain (e.g. "my-store" -> "my-store.myshopify.com")
 */
function cleanShopDomain(domain) {
  if (!domain) return '';
  let cleaned = domain.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!cleaned.includes('.')) {
    cleaned = `${cleaned}.myshopify.com`;
  }
  return cleaned;
}

/**
 * Sleep helper for rate limiting backoff
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute Shopify REST API request with automatic rate-limit backoff (Leaky Bucket)
 */
async function makeShopifyRequest({ shop, accessToken, method = 'GET', endpoint, data, params }) {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;
  let attempts = 0;
  const maxAttempts = 4;

  while (attempts < maxAttempts) {
    try {
      const response = await axios({
        url,
        method,
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        params,
        data,
        timeout: 25000,
      });

      // Check call limit header (e.g. "36/40")
      const callLimit = response.headers['x-shopify-shop-api-call-limit'];
      if (callLimit) {
        const [current, max] = callLimit.split('/').map(Number);
        if (current >= max - 3) {
          // Approaching limit, brief throttle pause
          await sleep(600);
        }
      }

      return response;
    } catch (err) {
      attempts++;
      if (err.response && err.response.status === 429 && attempts < maxAttempts) {
        // Shopify Rate limit hit! Check Retry-After header
        const retryAfter = parseFloat(err.response.headers['retry-after'] || '2.0');
        console.warn(`[ShopifyService] 429 Rate limit hit on ${shop}. Backing off for ${retryAfter}s...`);
        await sleep(retryAfter * 1000 + 300);
        continue;
      }
      throw err;
    }
  }
}

const ShopifyService = {
  /**
   * 1. Generate Shopify OAuth Install URL
   */
  generateAuthUrl(shopDomain, storeId, userId) {
    const shop = cleanShopDomain(shopDomain);
    if (!shop) throw new Error('Invalid Shopify store domain.');

    const scopes = [
      'read_products',
      'write_products',
      'read_orders',
      'write_orders',
      'read_inventory',
      'write_inventory',
      'read_customers',
      'read_fulfillments',
    ].join(',');

    const redirectUri = `${BACKEND_URL}/api/shopify/callback`;

    // State contains storeId and userId with cryptographic signature
    const statePayload = JSON.stringify({ storeId, userId, timestamp: Date.now() });
    const stateSig = crypto.createHmac('sha256', SHOPIFY_CLIENT_SECRET || 'secret').update(statePayload).digest('hex');
    const state = Buffer.from(JSON.stringify({ payload: statePayload, sig: stateSig })).toString('base64');

    return `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  },

  /**
   * 2. Verify OAuth Callback & Exchange Code for Permanent Token
   */
  async handleOAuthCallback({ shop, code, state, hmac, query }) {
    // Verify HMAC from Shopify
    if (SHOPIFY_CLIENT_SECRET && hmac) {
      const map = Object.assign({}, query);
      delete map['hmac'];
      delete map['signature'];
      const message = Object.keys(map)
        .sort()
        .map((key) => `${key}=${map[key]}`)
        .join('&');

      const generatedHmac = crypto.createHmac('sha256', SHOPIFY_CLIENT_SECRET).update(message).digest('hex');
      if (generatedHmac !== hmac) {
        throw new Error('HMAC signature verification failed.');
      }
    }

    // Decode state
    let stateData;
    try {
      const rawState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      const expectedSig = crypto.createHmac('sha256', SHOPIFY_CLIENT_SECRET || 'secret').update(rawState.payload).digest('hex');
      if (expectedSig !== rawState.sig) {
        throw new Error('OAuth state signature mismatch.');
      }
      stateData = JSON.parse(rawState.payload);
    } catch (_) {
      throw new Error('Invalid OAuth state parameter.');
    }

    const { storeId, userId } = stateData;
    const cleanShop = cleanShopDomain(shop);

    // Exchange code for permanent token
    const tokenRes = await axios.post(`https://${cleanShop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code,
    });

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('Failed to retrieve access token from Shopify.');

    // Save encrypted token in store integrations
    await this.connectStore(storeId, userId, cleanShop, accessToken);

    return { storeId, shop: cleanShop };
  },

  /**
   * 3. Verify Direct Token (Custom / Private App Token, e.g. "shpat_...")
   */
  async verifyAndConnectToken(storeId, userId, shopDomain, accessToken) {
    const shop = cleanShopDomain(shopDomain);
    const token = accessToken.trim();

    // Verify credentials with real Shopify Admin API
    const res = await makeShopifyRequest({
      shop,
      accessToken: token,
      endpoint: '/shop.json',
    });

    if (!res.data?.shop) {
      throw new Error('Invalid Shopify store response.');
    }

    const shopInfo = res.data.shop;

    // Save encrypted token & store details
    await this.connectStore(storeId, userId, shop, token, shopInfo);

    // Auto-register essential webhooks
    this.registerEssentialWebhooks(shop, token).catch((e) => {
      console.warn('[ShopifyService] Webhook auto-registration notice:', e.message);
    });

    // Trigger initial background sync
    this.syncFullCatalog(storeId, shop, token).catch((e) => {
      console.error('[ShopifyService] Initial sync error:', e.message);
    });

    return {
      success: true,
      shop: shopInfo.domain,
      name: shopInfo.name,
      currency: shopInfo.currency,
      email: shopInfo.email,
    };
  },

  /**
   * Connect and securely store credentials
   */
  async connectStore(storeId, userId, shop, accessToken, shopInfo = {}) {
    const encryptedToken = encrypt(accessToken);

    await StoreService.updateStoreIntegration(
      storeId,
      userId,
      'shopify',
      {
        shop_domain: shop,
        access_token_encrypted: encryptedToken,
        currency: shopInfo.currency || 'PKR',
        shop_name: shopInfo.name || shop,
        shop_id: shopInfo.id || null,
        installed_at: new Date().toISOString(),
        last_sync: new Date().toISOString(),
      },
      'connected'
    );

    // Update store domain and platform in store metadata
    await StoreService.updateStore(storeId, userId, {
      domain: shop,
      platform: 'Shopify',
    });

    // Notify connected frontend
    emitToStore(storeId, 'shopify:connected', {
      shop,
      shopName: shopInfo.name || shop,
      currency: shopInfo.currency || 'PKR',
    });
  },

  /**
   * Disconnect Shopify
   */
  async disconnectStore(storeId, userId) {
    await StoreService.updateStoreIntegration(
      storeId,
      userId,
      'shopify',
      {
        shop_domain: null,
        access_token_encrypted: null,
        disconnected_at: new Date().toISOString(),
      },
      'disconnected'
    );

    emitToStore(storeId, 'shopify:disconnected', { storeId });
    return true;
  },

  /**
   * Retrieve decrypted access token for a store
   */
  async getDecryptedToken(storeId, userId) {
    const integrations = await StoreService.getStoreIntegrations(storeId, userId);
    const shopifyConfig = integrations.find((i) => i.provider === 'shopify');

    if (!shopifyConfig || shopifyConfig.status !== 'connected' || !shopifyConfig.config?.access_token_encrypted) {
      return null;
    }

    const decrypted = decrypt(shopifyConfig.config.access_token_encrypted);
    return {
      shop: shopifyConfig.config.shop_domain,
      accessToken: decrypted,
    };
  },

  /**
   * 4. Register Essential Webhooks in Shopify
   */
  async registerEssentialWebhooks(shop, accessToken) {
    const webhookTopics = [
      { topic: 'products/create', path: '/api/shopify/webhooks/products-create' },
      { topic: 'products/update', path: '/api/shopify/webhooks/products-update' },
      { topic: 'products/delete', path: '/api/shopify/webhooks/products-delete' },
      { topic: 'orders/create', path: '/api/shopify/webhooks/orders-create' },
      { topic: 'orders/updated', path: '/api/shopify/webhooks/orders-updated' },
      { topic: 'inventory_levels/update', path: '/api/shopify/webhooks/inventory-update' },
      { topic: 'app/uninstalled', path: '/api/shopify/webhooks/app-uninstalled' },
    ];

    // Get currently registered webhooks to avoid duplicates
    try {
      const existing = await makeShopifyRequest({
        shop,
        accessToken,
        endpoint: '/webhooks.json',
      });
      const existingTopics = new Set((existing.data?.webhooks || []).map((w) => w.topic));

      for (const w of webhookTopics) {
        if (existingTopics.has(w.topic)) continue;

        const address = `${BACKEND_URL}${w.path}`;
        await makeShopifyRequest({
          shop,
          accessToken,
          method: 'POST',
          endpoint: '/webhooks.json',
          data: {
            webhook: {
              topic: w.topic,
              address,
              format: 'json',
            },
          },
        }).catch((e) => {
          // If webhook registration fails (e.g. localhost URL), log clearly
          console.warn(`[ShopifyService] Webhook ${w.topic} registration:`, e.response?.data?.errors || e.message);
        });
      }
    } catch (err) {
      console.warn('[ShopifyService] Register webhooks notice:', err.message);
    }
  },

  /**
   * 5. Initial Full Catalog Sync (Paginated)
   */
  async syncFullCatalog(storeId, shop, accessToken) {
    console.log(`🔄 [ShopifyService] Starting full catalog sync for store ${storeId} (${shop})...`);
    emitToStore(storeId, 'shopify:sync_started', { storeId, shop });

    let syncedCount = 0;
    let nextPageInfo = null;

    try {
      do {
        const params = { limit: 50 };
        if (nextPageInfo) {
          params.page_info = nextPageInfo;
        }

        const res = await makeShopifyRequest({
          shop,
          accessToken,
          endpoint: '/products.json',
          params,
        });

        const products = res.data?.products || [];
        for (const p of products) {
          // Extract primary variant & images
          const primaryVariant = p.variants?.[0] || {};
          const primaryImage = p.image?.src || p.images?.[0]?.src || null;
          const totalStock = p.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) || 0;
          const cleanDesc = p.body_html ? p.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

          const savedProd = await StoreService.addStoreProduct(storeId, {
            shopify_product_id: String(p.id),
            title: p.title,
            sku: primaryVariant.sku || `SP-${p.id}`,
            price: parseFloat(primaryVariant.price || '0'),
            compare_at_price: primaryVariant.compare_at_price ? parseFloat(primaryVariant.compare_at_price) : null,
            stock: totalStock,
            vendor: p.vendor || 'Shopify Store',
            category: p.product_type || 'General',
            description: cleanDesc,
            variants: (p.variants || []).map((v) => ({ id: v.id, title: v.title, price: v.price, sku: v.sku, stock: v.inventory_quantity })),
            status: p.status === 'active' ? 'active' : 'draft',
            image_url: primaryImage,
            returns_rate: 2.5,
            rto_risk: 'Low',
          });

          // Generate vector embedding in background
          AIService.embedProduct(storeId, savedProd).catch((e) => {
            console.warn('[ShopifyService] Auto-embedding note:', e.message);
          });

          syncedCount++;
        }

        // Parse Link header for cursor pagination
        const linkHeader = res.headers['link'];
        nextPageInfo = null;
        if (linkHeader) {
          const nextMatch = linkHeader.match(/<[^>]+page_info=([^>&]+)[^>]*>;\s*rel="next"/);
          if (nextMatch) {
            nextPageInfo = nextMatch[1];
          }
        }
      } while (nextPageInfo);

      console.log(`✅ [ShopifyService] Full sync completed: ${syncedCount} products synced.`);
      emitToStore(storeId, 'shopify:sync_completed', {
        storeId,
        syncedCount,
        timestamp: new Date().toISOString(),
      });

      return { success: true, count: syncedCount };
    } catch (err) {
      console.error('[ShopifyService] Catalog sync error:', err.message);
      emitToStore(storeId, 'shopify:sync_failed', { storeId, error: err.message });
      throw err;
    }
  },

  /**
   * 6. Bidirectional Sync: Push Product Update to Shopify
   */
  async updateProductInShopify(storeId, userId, shopifyProductId, updateData) {
    const creds = await this.getDecryptedToken(storeId, userId);
    if (!creds) throw new Error('Shopify integration not active or credentials missing.');

    const { shop, accessToken } = creds;

    const payload = {
      product: {
        id: shopifyProductId,
        ...(updateData.title && { title: updateData.title }),
        ...(updateData.status && { status: updateData.status }),
      },
    };

    const res = await makeShopifyRequest({
      shop,
      accessToken,
      method: 'PUT',
      endpoint: `/products/${shopifyProductId}.json`,
      data: payload,
    });

    return res.data?.product;
  },

  /**
   * 7. Webhook Signature Verification
   */
  verifyWebhook(rawBody, hmacHeader) {
    const secret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!secret || !hmacHeader || !rawBody) {
      return false;
    }
    return verifyHmacSha256(rawBody, secret, hmacHeader);
  },

  /**
   * 8. Webhook Processing (Idempotent + Multi-Tenant Isolation)
   */
  async handleWebhookEvent({ topic, shopDomain, webhookId, payload }) {
    if (isWebhookProcessed(webhookId)) {
      console.log(`⚡ [ShopifyService] Idempotency: Webhook ${webhookId} already processed. Skipping.`);
      return { skipped: true };
    }

    const cleanShop = cleanShopDomain(shopDomain);
    console.log(`📦 [ShopifyService] Processing webhook [${topic}] for ${cleanShop}`);

    // Find internal store belonging to this Shopify domain
    const store = await StoreService.findStoreByDomain(cleanShop);
    if (!store) {
      console.warn(`[ShopifyService] No internal store found for domain ${cleanShop}`);
      return { unmapped: true };
    }

    const storeId = store.id;

    switch (topic) {
      case 'products/create':
      case 'products/update': {
        const primaryVariant = payload.variants?.[0] || {};
        const primaryImage = payload.image?.src || payload.images?.[0]?.src || null;
        const totalStock = payload.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) || 0;
        const cleanDesc = payload.body_html ? payload.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

        const product = await StoreService.upsertStoreProduct(storeId, {
          shopify_product_id: String(payload.id),
          title: payload.title,
          sku: primaryVariant.sku || `SP-${payload.id}`,
          price: parseFloat(primaryVariant.price || '0'),
          compare_at_price: primaryVariant.compare_at_price ? parseFloat(primaryVariant.compare_at_price) : null,
          stock: totalStock,
          vendor: payload.vendor || 'Shopify',
          category: payload.product_type || 'General',
          description: cleanDesc,
          variants: (payload.variants || []).map((v) => ({ id: v.id, title: v.title, price: v.price, sku: v.sku, stock: v.inventory_quantity })),
          status: payload.status === 'active' ? 'active' : 'draft',
          image_url: primaryImage,
        });

        // Auto-update AI Vector Embedding in background
        AIService.embedProduct(storeId, product).catch((e) => console.warn('[Shopify] Embedding update error:', e.message));

        // Emit realtime update strictly to this store
        emitToStore(storeId, 'shopify:product_updated', { storeId, product });
        break;
      }

      case 'products/delete': {
        const productId = payload.id;
        await StoreService.deleteProductByExternalId(storeId, productId);
        emitToStore(storeId, 'shopify:product_deleted', { storeId, productId });
        break;
      }

      case 'orders/create':
      case 'orders/updated': {
        const orderNum = payload.name || payload.order_number ? String(payload.name || payload.order_number) : `ORD-${payload.id}`;
        const customerName = payload.customer
          ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim()
          : payload.shipping_address?.name || 'Shopify Customer';
        const customerPhone = payload.customer?.phone || payload.shipping_address?.phone || '';
        const customerEmail = payload.customer?.email || '';
        const address = payload.shipping_address ? `${payload.shipping_address.address1 || ''} ${payload.shipping_address.city || ''}` : '';

        const order = await StoreService.createStoreOrder(storeId, {
          order_number: orderNum,
          channel: 'shopify',
          shopify_order_id: String(payload.id),
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          address,
          city: payload.shipping_address?.city || 'Karachi',
          total_amount: parseFloat(payload.total_price || '0'),
          payment_method: payload.gateway?.toLowerCase().includes('cod') || payload.payment_gateway_names?.some((g) => g.toLowerCase().includes('cod')) ? 'cod' : 'online',
          payment_status: payload.financial_status === 'paid' ? 'paid' : 'pending',
          order_status: payload.fulfillment_status === 'fulfilled' ? 'delivered' : 'unfulfilled',
          items: (payload.line_items || []).map((li) => ({
            title: li.title,
            price: parseFloat(li.price || '0'),
            quantity: li.quantity || 1,
            sku: li.sku || '',
          })),
        });

        emitToStore(storeId, 'shopify:order_updated', {
          storeId,
          order,
          orderId: payload.id,
          orderNumber: orderNum,
          totalPrice: payload.total_price,
          financialStatus: payload.financial_status,
          fulfillmentStatus: payload.fulfillment_status,
        });
        break;
      }

      case 'app/uninstalled': {
        await StoreService.updateStoreIntegration(
          storeId,
          store.user_id,
          'shopify',
          { uninstalled_at: new Date().toISOString() },
          'disconnected'
        );
        emitToStore(storeId, 'shopify:disconnected', { storeId });
        break;
      }

      default:
        console.log(`[ShopifyService] Unhandled webhook topic: ${topic}`);
    }

    return { success: true, storeId };
  },
};

module.exports = ShopifyService;

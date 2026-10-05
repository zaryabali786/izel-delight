const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const DATA_DIR = path.join(__dirname, '../../data');
const LOCAL_STORES_FILE = path.join(DATA_DIR, 'stores_db.json');

// Ensure local fallback data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper to read local stores fallback
function readLocalDb() {
  try {
    if (!fs.existsSync(LOCAL_STORES_FILE)) {
      return {
        stores: [],
        integrations: [],
        products: [],
        metrics: [],
        orders: [],
        conversations: [],
        shipments: [],
        ad_metrics: [],
      };
    }
    const raw = fs.readFileSync(LOCAL_STORES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.stores) data.stores = [];
    if (!data.integrations) data.integrations = [];
    if (!data.products) data.products = [];
    if (!data.metrics) data.metrics = [];
    if (!data.orders) data.orders = [];
    if (!data.conversations) data.conversations = [];
    if (!data.shipments) data.shipments = [];
    if (!data.ad_metrics) data.ad_metrics = [];
    return data;
  } catch (err) {
    console.error('[StoreService] readLocalDb error:', err.message);
    return {
      stores: [],
      integrations: [],
      products: [],
      metrics: [],
      orders: [],
      conversations: [],
      shipments: [],
      ad_metrics: [],
    };
  }
}

function writeLocalDb(data) {
  try {
    fs.writeFileSync(LOCAL_STORES_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[StoreService] writeLocalDb error:', err.message);
  }
}

/**
 * Check if a Supabase error is due to missing tables
 */
function isTableMissingError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('could not find the table') ||
    msg.includes('relation') ||
    msg.includes('schema cache') ||
    err.code === '42P01' ||
    err.code === 'PGRST205'
  );
}

// ── Default templates for new stores ─────────────────────────────────────────

function normalizeProviderId(provider) {
  if (!provider) return provider;
  const map = {
    meta_ads: 'meta-ads',
    tiktok_ads: 'tiktok-ads',
    google_ads: 'google-ads',
    snapchat_ads: 'snapchat-ads',
    whatsapp: 'whatsapp-business',
    whatsapp_business: 'whatsapp-business',
    postex: 'postex-courier',
    trax: 'trax-logistics',
    leopards: 'leopards-courier',
    tcs: 'tcs-courier',
    callcourier: 'call-courier',
    call_courier: 'call-courier',
    mnp: 'mnp-courier',
    rider: 'rider-courier',
  };
  return map[provider] || provider;
}

function getDefaultIntegrations(storeId, userId, isNewSubStore = false, storeDomain = '') {
  if (isNewSubStore) {
    // New secondary store starts with completely clean unlinked integrations
    return [
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'shopify', status: 'not_connected', config: { shop_domain: storeDomain || 'store.myshopify.com' }, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'meta-ads', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'google-ads', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'tiktok-ads', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'snapchat-ads', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'whatsapp-business', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'postex-courier', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'trax-logistics', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'leopards-courier', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'tcs-courier', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'call-courier', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'mnp-courier', status: 'not_connected', config: {}, last_synced_at: null },
      { id: crypto.randomUUID(), store_id: storeId, user_id: userId, provider: 'rider-courier', status: 'not_connected', config: {}, last_synced_at: null },
    ];
  }

  // Primary store default showcase
  return [
    {
      id: crypto.randomUUID(),
      store_id: storeId,
      user_id: userId,
      provider: 'shopify',
      status: 'connected',
      config: {
        shop_domain: storeDomain || 'store.myshopify.com',
        synced_products: 1450,
        webhook_active: true,
      },
      last_synced_at: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      store_id: storeId,
      user_id: userId,
      provider: 'meta-ads',
      status: 'connected',
      config: {
        pixel_id: '908234120938471',
        roas_sync: true,
      },
      last_synced_at: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      store_id: storeId,
      user_id: userId,
      provider: 'tiktok-ads',
      status: 'connected',
      config: {
        pixel_id: 'TT-76541289',
        reels_tracking: true,
      },
      last_synced_at: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      store_id: storeId,
      user_id: userId,
      provider: 'postex-courier',
      status: 'connected',
      config: {
        merchant_code: 'PX-9921',
        auto_fraud_detect: true,
      },
      last_synced_at: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      store_id: storeId,
      user_id: userId,
      provider: 'trax-logistics',
      status: 'not_connected',
      config: {},
      last_synced_at: null,
    },
    {
      id: crypto.randomUUID(),
      store_id: storeId,
      user_id: userId,
      provider: 'google-ads',
      status: 'connected',
      config: {
        conversion_id: 'AW-9812034',
      },
      last_synced_at: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      store_id: storeId,
      user_id: userId,
      provider: 'snapchat-ads',
      status: 'not_connected',
      config: {},
      last_synced_at: null,
    },
    {
      id: crypto.randomUUID(),
      store_id: storeId,
      user_id: userId,
      provider: 'whatsapp-business',
      status: 'connected',
      config: {
        phone_number_id: '109284719283719',
        bot_active: true,
      },
      last_synced_at: new Date().toISOString(),
    },
  ];
}

function getDefaultMetrics(storeId) {
  return {
    id: crypto.randomUUID(),
    store_id: storeId,
    gross_revenue: 0,
    net_sales: 0,
    rto_loss: 0,
    cogs: 0,
    ad_spend: 0,
    courier_fees: 0,
    net_profit: 0,
    net_margin_pct: 0,
    total_orders: 0,
    aov: 0,
    roas: 0,
    cac: 0,
    conversion_rate: 0,
    channel_data: [],
    insights: null,
    has_sufficient_data: false,
    updated_at: new Date().toISOString(),
  };
}

// ── Store Service API ────────────────────────────────────────────────────────

const StoreService = {
  /**
   * Get all stores owned by a specific user
   */
  async getUserStores(userId, userMetadata = {}) {
    try {
      // 1. Try Supabase
      const { data, error } = await supabaseAdmin
        .from('stores')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        if (data.length > 0) return data;
        // If user has no store in Supabase, create their first store
        const defaultStore = await this.createStore(userId, {
          name: userMetadata.company || `${userMetadata.full_name || 'My'} Store`,
          domain: `${(userMetadata.company || 'store').toLowerCase().replace(/[^a-z0-9]/g, '')}.myshopify.com`,
          platform: 'Shopify',
          currency: 'PKR',
        });
        return [defaultStore];
      }

      if (error && !isTableMissingError(error)) {
        console.error('[StoreService] Supabase error in getUserStores:', error.message);
      }
    } catch (err) {
      console.warn('[StoreService] Supabase query failed, using local store repo:', err.message);
    }

    // 2. Fallback to Local Repository
    const db = readLocalDb();
    let userStores = db.stores.filter((s) => s.user_id === userId);

    if (userStores.length === 0) {
      // Auto-provision initial store for the new tenant
      const initialStore = {
        id: crypto.randomUUID(),
        user_id: userId,
        name: userMetadata.company || `${userMetadata.full_name || 'My'} Store`,
        domain: `${(userMetadata.company || 'store').toLowerCase().replace(/[^a-z0-9]/g, '')}.myshopify.com`,
        platform: 'Shopify',
        currency: 'PKR',
        currency_symbol: 'PKR ',
        status: 'active',
        settings: {
          notifications_enabled: true,
          auto_fraud_shield: true,
          ai_prompt: `You are the official WhatsApp AI Sales Executive for this store. Help customers find products, verify sizes and fabric, and place Cash on Delivery or Online orders politely in English or Urdu/Roman Urdu. Only quote exact prices and stock available in store.`,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      db.stores.push(initialStore);

      const integrations = getDefaultIntegrations(initialStore.id, userId);
      const metrics = getDefaultMetrics(initialStore.id);

      db.integrations.push(...integrations);
      db.metrics.push(metrics);

      writeLocalDb(db);
      userStores = [initialStore];
    }

    return userStores;
  },

  /**
   * Create a new store (isolated tenant)
   */
  async createStore(userId, storeData) {
    const storeId = crypto.randomUUID();
    const newStore = {
      id: storeId,
      user_id: userId,
      name: storeData.name || 'New Store',
      domain: storeData.domain || `${storeData.name?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mystore'}.myshopify.com`,
      platform: storeData.platform || 'Shopify',
      currency: storeData.currency || 'PKR',
      currency_symbol: storeData.currency === 'USD' ? '$' : 'PKR ',
      logo_url: storeData.logo_url || null,
      status: 'active',
      settings: storeData.settings || {
        notifications_enabled: true,
        auto_fraud_shield: true,
        ai_prompt: `You are the official WhatsApp AI Sales Executive for "${storeData.name || 'our store'}". Help customers find products, verify sizes and fabric, and place Cash on Delivery or Online orders politely in English or Urdu/Roman Urdu. Only quote exact prices and stock available in store.`,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Check if this is a secondary store created by merchant
    const existingStores = await this.getUserStores(userId);
    const isNewSubStore = existingStores && existingStores.length > 0;
    const initialIntegrations = getDefaultIntegrations(storeId, userId, isNewSubStore, newStore.domain);

    // 1. Try Supabase
    try {
      const { data, error } = await supabaseAdmin.from('stores').insert(newStore).select().single();
      if (!error && data) {
        try {
          await supabaseAdmin.from('store_metrics').insert(getDefaultMetrics(storeId));
          await supabaseAdmin.from('store_integrations').insert(initialIntegrations);
        } catch (_) {}
        return data;
      }
    } catch (err) {
      console.warn('[StoreService] Supabase insert failed, saving locally:', err.message);
    }

    // 2. Local Fallback
    const db = readLocalDb();
    db.stores.push(newStore);
    db.integrations.push(...initialIntegrations);
    db.metrics.push(getDefaultMetrics(storeId));
    writeLocalDb(db);

    return newStore;
  },

  /**
   * Get store by ID (verifying tenant ownership)
   */
  async getStoreById(storeId, userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .eq('user_id', userId)
        .single();
      if (!error && data) return data;
    } catch (_) {}

    const db = readLocalDb();
    return db.stores.find((s) => s.id === storeId && s.user_id === userId) || null;
  },

  /**
   * Get store by ID without user check (internal service use only)
   */
  async getStoreByIdWithoutUser(storeId) {
    try {
      const { data, error } = await supabaseAdmin.from('stores').select('*').eq('id', storeId).single();
      if (!error && data) return data;
    } catch (_) {}

    const db = readLocalDb();
    return db.stores.find((s) => s.id === storeId) || null;
  },

  /**
   * Update store details
   */
  async updateStore(storeId, userId, updateData) {
    const updates = {
      ...updateData,
      updated_at: new Date().toISOString(),
    };

    try {
      const { data, error } = await supabaseAdmin
        .from('stores')
        .update(updates)
        .eq('id', storeId)
        .eq('user_id', userId)
        .select()
        .single();
      if (!error && data) return data;
    } catch (_) {}

    const db = readLocalDb();
    const index = db.stores.findIndex((s) => s.id === storeId && s.user_id === userId);
    if (index === -1) return null;

    db.stores[index] = { ...db.stores[index], ...updates };
    writeLocalDb(db);
    return db.stores[index];
  },

  /**
   * Delete store and all its data
   */
  async deleteStore(storeId, userId) {
    try {
      await supabaseAdmin.from('stores').delete().eq('id', storeId).eq('user_id', userId);
    } catch (_) {}

    const db = readLocalDb();
    db.stores = db.stores.filter((s) => !(s.id === storeId && s.user_id === userId));
    db.integrations = db.integrations.filter((i) => i.store_id !== storeId);
    db.products = db.products.filter((p) => p.store_id !== storeId);
    db.metrics = db.metrics.filter((m) => m.store_id !== storeId);
    db.orders = db.orders.filter((o) => o.store_id !== storeId);
    db.conversations = db.conversations.filter((c) => c.store_id !== storeId);
    db.shipments = db.shipments.filter((s) => s.store_id !== storeId);
    writeLocalDb(db);
    return true;
  },

  // ── Store Integrations ─────────────────────────────────────────────────────

  async getStoreIntegrations(storeId, userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('store_integrations')
        .select('*')
        .eq('store_id', storeId);
      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map((item) => ({
          ...item,
          provider: normalizeProviderId(item.provider),
        }));
      }
    } catch (_) {}

    const db = readLocalDb();
    let list = db.integrations.filter((i) => i.store_id === storeId);
    if (list.length === 0) {
      list = getDefaultIntegrations(storeId, userId, false);
      db.integrations.push(...list);
      writeLocalDb(db);
    }
    return list.map((item) => ({
      ...item,
      provider: normalizeProviderId(item.provider),
    }));
  },

  async getStoreIntegrationsSimple(storeId) {
    const db = readLocalDb();
    return db.integrations.filter((i) => i.store_id === storeId);
  },

  async updateStoreIntegration(storeId, userId, provider, config, status = 'connected') {
    const normProvider = normalizeProviderId(provider);
    const item = {
      store_id: storeId,
      user_id: userId,
      provider: normProvider,
      status,
      config,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      const { data, error } = await supabaseAdmin
        .from('store_integrations')
        .upsert(item, { onConflict: 'store_id, provider' })
        .select()
        .single();
      if (!error && data) return data;
    } catch (_) {}

    const db = readLocalDb();
    const index = db.integrations.findIndex((i) => i.store_id === storeId && i.provider === normProvider);
    if (index >= 0) {
      db.integrations[index] = { ...db.integrations[index], ...item };
    } else {
      db.integrations.push({ id: crypto.randomUUID(), ...item });
    }
    writeLocalDb(db);
    return item;
  },

  // ── Store Catalog / Products (with Vector Embeddings) ───────────────────────

  async getStoreProducts(storeId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('store_products')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });
      if (!error && Array.isArray(data) && data.length > 0) return data;
    } catch (_) {}

    const db = readLocalDb();
    return db.products.filter((p) => p.store_id === storeId);
  },

  async addStoreProduct(storeId, productData) {
    const newProduct = {
      id: crypto.randomUUID(),
      store_id: storeId,
      shopify_product_id: productData.shopify_product_id || null,
      title: productData.title,
      sku: productData.sku || `SKU-${Date.now().toString().slice(-4)}`,
      price: Number(productData.price) || 0,
      compare_at_price: productData.compare_at_price ? Number(productData.compare_at_price) : null,
      cogs: Number(productData.cogs) || Math.round((Number(productData.price) || 0) * 0.4),
      stock: Number(productData.stock) || 0,
      vendor: productData.vendor || 'Shopify Store',
      category: productData.category || 'General',
      description: productData.description || '',
      variants: Array.isArray(productData.variants) ? productData.variants : [],
      status: productData.status || 'active',
      image_url: productData.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80',
      returns_rate: productData.returns_rate || 0,
      rto_risk: productData.rto_risk || 'Low',
      embedding: productData.embedding || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      const { data, error } = await supabaseAdmin.from('store_products').insert(newProduct).select().single();
      if (!error && data) return data;
    } catch (_) {}

    const db = readLocalDb();
    db.products.unshift(newProduct);
    writeLocalDb(db);
    return newProduct;
  },

  async updateProductEmbedding(storeId, productId, embedding) {
    const db = readLocalDb();
    const index = db.products.findIndex((p) => p.id === productId && p.store_id === storeId);
    if (index >= 0) {
      db.products[index].embedding = embedding;
      db.products[index].updated_at = new Date().toISOString();
      writeLocalDb(db);
    }
    try {
      await supabaseAdmin
        .from('store_products')
        .update({ embedding, updated_at: new Date().toISOString() })
        .eq('id', productId)
        .eq('store_id', storeId);
    } catch (_) {}
  },

  async deleteStoreProduct(storeId, productId) {
    try {
      await supabaseAdmin.from('store_products').delete().eq('id', productId).eq('store_id', storeId);
    } catch (_) {}

    const db = readLocalDb();
    db.products = db.products.filter((p) => !(p.id === productId && p.store_id === storeId));
    writeLocalDb(db);
    return true;
  },

  async deleteProductByExternalId(storeId, externalId) {
    const skuPattern = `SP-${externalId}`;
    try {
      await supabaseAdmin
        .from('store_products')
        .delete()
        .eq('store_id', storeId)
        .or(`sku.eq.${skuPattern},shopify_product_id.eq.${externalId}`);
    } catch (_) {}

    const db = readLocalDb();
    db.products = db.products.filter(
      (p) => !(p.store_id === storeId && (p.sku === skuPattern || p.shopify_product_id === String(externalId) || p.id === String(externalId)))
    );
    writeLocalDb(db);
    return true;
  },

  async upsertStoreProduct(storeId, productData) {
    const sku = productData.sku || `SP-${Date.now()}`;
    const db = readLocalDb();
    const existingIndex = db.products.findIndex(
      (p) =>
        p.store_id === storeId &&
        (p.sku === sku ||
          (productData.shopify_product_id && p.shopify_product_id === productData.shopify_product_id) ||
          p.title.toLowerCase() === productData.title.toLowerCase())
    );

    const productPayload = {
      store_id: storeId,
      shopify_product_id: productData.shopify_product_id || null,
      title: productData.title,
      sku,
      price: Number(productData.price) || 0,
      compare_at_price: productData.compare_at_price ? Number(productData.compare_at_price) : null,
      cogs: Number(productData.cogs) || Math.round((Number(productData.price) || 0) * 0.4),
      stock: Number(productData.stock) || 0,
      vendor: productData.vendor || 'Shopify',
      category: productData.category || 'General',
      description: productData.description || '',
      variants: Array.isArray(productData.variants) ? productData.variants : [],
      status: productData.status || 'active',
      image_url: productData.image_url || null,
      updated_at: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      db.products[existingIndex] = { ...db.products[existingIndex], ...productPayload };
      writeLocalDb(db);
      return db.products[existingIndex];
    } else {
      const newProduct = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...productPayload,
      };
      db.products.unshift(newProduct);
      writeLocalDb(db);
      return newProduct;
    }
  },

  async findStoreByDomain(domain) {
    const clean = domain.trim().toLowerCase();
    try {
      const { data, error } = await supabaseAdmin
        .from('stores')
        .select('*')
        .or(`domain.ilike.%${clean}%,settings->>shop_domain.ilike.%${clean}%`)
        .limit(1);
      if (!error && data && data.length > 0) return data[0];
    } catch (_) {}

    const db = readLocalDb();
    let found = db.stores.find((s) => s.domain && s.domain.toLowerCase().includes(clean));
    if (found) return found;

    const integration = db.integrations.find(
      (i) => i.provider === 'shopify' && i.config?.shop_domain && i.config.shop_domain.toLowerCase().includes(clean)
    );
    if (integration) {
      found = db.stores.find((s) => s.id === integration.store_id);
    }

    return found || null;
  },

  // ── Multi-Tenant Orders (Shopify & WhatsApp) ────────────────────────────────

  async getStoreOrders(storeId, channel = 'all') {
    const db = readLocalDb();
    let orders = db.orders.filter((o) => o.store_id === storeId);
    if (channel && channel !== 'all') {
      orders = orders.filter((o) => o.channel === channel);
    }
    return orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async createStoreOrder(storeId, orderData) {
    const db = readLocalDb();
    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;
    const newOrder = {
      id: crypto.randomUUID(),
      store_id: storeId,
      order_number: orderData.order_number || orderNumber,
      channel: orderData.channel || 'whatsapp', // 'shopify' | 'whatsapp'
      shopify_order_id: orderData.shopify_order_id || null,
      customer_name: orderData.customer_name || 'Guest Customer',
      customer_phone: orderData.customer_phone || '',
      customer_email: orderData.customer_email || '',
      address: orderData.address || '',
      city: orderData.city || 'Karachi',
      postal_code: orderData.postal_code || '',
      items: Array.isArray(orderData.items) ? orderData.items : [],
      total_amount: Number(orderData.total_amount) || 0,
      payment_method: orderData.payment_method || 'cod', // 'cod' | 'online'
      payment_status: orderData.payment_status || (orderData.payment_method === 'online' ? 'paid' : 'pending'),
      order_status: orderData.order_status || 'unfulfilled', // 'unfulfilled' | 'shipped' | 'delivered' | 'cancelled'
      courier_name: orderData.courier_name || 'PostEx Logistics',
      tracking_number: orderData.tracking_number || `TRK-${Date.now().toString().slice(-8)}`,
      whatsapp_conversation_id: orderData.whatsapp_conversation_id || null,
      tags: orderData.tags || (orderData.channel === 'whatsapp' ? ['Order from WhatsApp'] : ['Shopify Storefront']),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.orders.unshift(newOrder);

    // Also auto-create a courier shipment for tracking
    db.shipments.unshift({
      id: crypto.randomUUID(),
      store_id: storeId,
      order_id: newOrder.id,
      courier: 'postex',
      tracking_number: newOrder.tracking_number,
      customer_name: newOrder.customer_name,
      city: newOrder.city,
      amount: newOrder.total_amount,
      status: 'booking',
      cod_collected: 0,
      shipping_fee: 250,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    writeLocalDb(db);

    // Recalculate metrics for store
    await this.recalculateStoreMetrics(storeId);

    return newOrder;
  },

  async updateStoreOrder(storeId, orderId, updates) {
    const db = readLocalDb();
    const index = db.orders.findIndex((o) => o.id === orderId && o.store_id === storeId);
    if (index === -1) return null;

    db.orders[index] = {
      ...db.orders[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    writeLocalDb(db);

    await this.recalculateStoreMetrics(storeId);
    return db.orders[index];
  },

  async getCustomerOrdersByPhone(storeId, phone) {
    if (!phone) return [];
    const clean = phone.replace(/[^0-9]/g, '');
    const db = readLocalDb();
    return db.orders.filter(
      (o) => o.store_id === storeId && o.customer_phone && o.customer_phone.replace(/[^0-9]/g, '').includes(clean)
    );
  },

  // ── Multi-Tenant WhatsApp Conversations ─────────────────────────────────────

  async getStoreWhatsAppConversations(storeId) {
    const db = readLocalDb();
    let list = db.conversations.filter((c) => c.store_id === storeId);

    if (list.length === 0) {
      // Create initial welcoming conversation template for this store if none exists
      const store = db.stores.find((s) => s.id === storeId);
      const storeName = store ? store.name : 'Store';
      const initialConv = {
        id: crypto.randomUUID(),
        store_id: storeId,
        customer_name: 'Amina Tariq',
        customer_phone: '+92 300 8472910',
        city: 'Lahore, Punjab',
        status: 'Inquiry',
        unread_count: 0,
        messages: [
          {
            id: `msg-init-1`,
            sender: 'customer',
            text: `Assalam-o-Alaikum! Are you currently taking Cash on Delivery orders for ${storeName}?`,
            type: 'text',
            timestamp: '10:15 AM',
            status: 'read',
          },
          {
            id: `msg-init-2`,
            sender: 'ai',
            text: `Walaikum Assalam! Yes, we offer nationwide 100% Cash on Delivery across Pakistan with fast 2-3 business days delivery. How can I assist you with our catalog today? ✨`,
            type: 'text',
            timestamp: '10:16 AM',
            status: 'read',
            isAiResponse: true,
          },
        ],
        last_message: 'Yes, we offer nationwide 100% Cash on Delivery across Pakistan.',
        last_timestamp: '10:16 AM',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.conversations.push(initialConv);
      writeLocalDb(db);
      list = [initialConv];
    }

    return list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  },

  async getOrCreateWhatsAppConversation(storeId, phone, name) {
    const db = readLocalDb();
    const cleanPhone = phone.trim();
    let conv = db.conversations.find((c) => c.store_id === storeId && c.customer_phone === cleanPhone);

    if (!conv) {
      conv = {
        id: crypto.randomUUID(),
        store_id: storeId,
        customer_name: name || 'Customer',
        customer_phone: cleanPhone,
        city: 'Karachi, Sindh',
        status: 'Inquiry',
        unread_count: 0,
        messages: [],
        last_message: '',
        last_timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.conversations.unshift(conv);
      writeLocalDb(db);
    }
    return conv;
  },

  async updateWhatsAppConversation(storeId, conversationId, data) {
    const db = readLocalDb();
    const index = db.conversations.findIndex((c) => c.id === conversationId && c.store_id === storeId);
    if (index >= 0) {
      db.conversations[index] = {
        ...db.conversations[index],
        ...data,
        updated_at: new Date().toISOString(),
      };
      writeLocalDb(db);
      return db.conversations[index];
    }
    return null;
  },

  // ── Store AI Prompt ────────────────────────────────────────────────────────

  async getStoreAIPrompt(storeId) {
    const store = await this.getStoreByIdWithoutUser(storeId);
    return (
      store?.settings?.ai_prompt ||
      `You are the official WhatsApp AI Sales Executive for "${store?.name || 'our store'}". Help customers find products, verify sizes and fabric, and place Cash on Delivery or Online orders politely in English or Urdu/Roman Urdu. Only quote exact prices and stock available in store.`
    );
  },

  async updateStoreAIPrompt(storeId, aiPrompt) {
    const db = readLocalDb();
    const index = db.stores.findIndex((s) => s.id === storeId);
    if (index >= 0) {
      db.stores[index].settings = db.stores[index].settings || {};
      db.stores[index].settings.ai_prompt = aiPrompt;
      db.stores[index].updated_at = new Date().toISOString();
      writeLocalDb(db);
      return db.stores[index];
    }
    return null;
  },

  // ── Real Store Analytics & Calculations ────────────────────────────────────

  async getStoreMetrics(storeId) {
    const db = readLocalDb();
    let metrics = db.metrics.find((m) => m.store_id === storeId);
    if (!metrics) {
      metrics = getDefaultMetrics(storeId);
      db.metrics.push(metrics);
      writeLocalDb(db);
    }
    return metrics;
  },

  async updateStoreInsights(storeId, insights) {
    const db = readLocalDb();
    const index = db.metrics.findIndex((m) => m.store_id === storeId);
    if (index >= 0) {
      db.metrics[index].insights = insights;
      db.metrics[index].updated_at = new Date().toISOString();
      writeLocalDb(db);
    }
  },

  /**
   * Aggregate complete multi-channel data (Ads, Couriers, WhatsApp, Shopify)
   */
  async getStoreMultiChannelTelemetry(storeId) {
    const db = readLocalDb();
    const orders = db.orders.filter((o) => o.store_id === storeId);
    const shipments = db.shipments.filter((s) => s.store_id === storeId);
    const conversations = db.conversations.filter((c) => c.store_id === storeId);
    const products = db.products.filter((p) => p.store_id === storeId);
    const adMetrics = db.ad_metrics.filter((a) => a.store_id === storeId);

    const grossRevenue = orders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const totalOrders = orders.length;

    // 1. AD CHANNELS (Meta, Google, TikTok, Snapchat)
    const adPlatforms = [
      { id: 'meta-ads', name: 'Meta Ads (FB/Instagram)', defaultShare: 0.52 },
      { id: 'google-ads', name: 'Google Ads (Search/Shopping)', defaultShare: 0.28 },
      { id: 'tiktok-ads', name: 'TikTok Ads & Spark', defaultShare: 0.15 },
      { id: 'snapchat-ads', name: 'Snapchat Ads', defaultShare: 0.05 },
    ];

    let adsData = [];
    if (adMetrics.length > 0) {
      adsData = adMetrics;
    } else if (grossRevenue > 0) {
      const estimatedAdSpend = Math.round(grossRevenue * 0.24);
      adsData = adPlatforms.map((p) => {
        const platformSpend = Math.round(estimatedAdSpend * p.defaultShare);
        const platformRevenue = Math.round(grossRevenue * (p.defaultShare * 1.05));
        const roas = platformSpend > 0 ? Number((platformRevenue / platformSpend).toFixed(2)) : 0;
        return {
          platform: p.name,
          platform_id: p.id,
          spend: platformSpend,
          revenue: platformRevenue,
          roas: roas,
          clicks: Math.round(platformSpend / 18),
          ctr: (1.8 + (p.defaultShare * 2)).toFixed(1),
          cpc: 18,
          conversions: Math.round(totalOrders * p.defaultShare),
        };
      });
    } else {
      adsData = adPlatforms.map((p) => ({
        platform: p.name,
        platform_id: p.id,
        spend: 0,
        revenue: 0,
        roas: 0,
        clicks: 0,
        ctr: '0.0',
        cpc: 0,
        conversions: 0,
      }));
    }

    // 2. COURIER LOGISTICS CHANNELS (PostEx, Trax, Leopards, TCS)
    const courierNames = ['PostEx Logistics', 'Trax Logistics', 'Leopards Courier', 'TCS Logistics'];
    const couriersData = courierNames.map((cName) => {
      const cShipments = shipments.filter((s) => (s.courier || '').toLowerCase().includes(cName.slice(0, 4).toLowerCase()));
      const dispatched = cShipments.length;
      const delivered = cShipments.filter((s) => s.status === 'delivered').length;
      const returned = cShipments.filter((s) => s.status === 'returned').length;
      const inTransit = dispatched - delivered - returned;
      const rate = dispatched > 0 ? Math.round((delivered / dispatched) * 100) : (totalOrders > 0 && cName === 'PostEx Logistics' ? 92 : 0);
      const rto = dispatched > 0 ? Math.round((returned / dispatched) * 100) : (totalOrders > 0 && cName === 'Trax Logistics' ? 12 : 0);
      const collected = cShipments.reduce((sum, s) => sum + (s.cod_collected || 0), 0);
      const fees = dispatched * 250;

      return {
        courier: cName,
        dispatched: dispatched || (totalOrders > 0 && cName === 'PostEx Logistics' ? totalOrders : 0),
        delivered: delivered || (totalOrders > 0 && cName === 'PostEx Logistics' ? Math.round(totalOrders * 0.9) : 0),
        in_transit: Math.max(0, inTransit),
        returned_rto: returned,
        delivery_success_rate: rate,
        rto_rate: rto,
        cod_collected: collected || (totalOrders > 0 && cName === 'PostEx Logistics' ? Math.round(grossRevenue * 0.85) : 0),
        shipping_fees: fees,
      };
    });

    // 3. WHATSAPP CONVERSATIONAL SALES CHANNEL
    const whatsappOrders = orders.filter((o) => o.channel === 'whatsapp');
    const whatsappRevenue = whatsappOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const voiceCount = conversations.reduce((sum, c) => sum + (c.messages || []).filter((m) => m.type === 'voice').length, 0);
    const whatsappConversionRate = conversations.length > 0 ? Math.round((whatsappOrders.length / conversations.length) * 100) : 0;

    // 4. SHOPIFY STOREFRONT CHANNEL
    const shopifyOrders = orders.filter((o) => o.channel === 'shopify');
    const shopifyRevenue = shopifyOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

    return {
      store_id: storeId,
      has_sufficient_data: totalOrders > 0 || grossRevenue > 0 || products.length > 0,
      financials: {
        gross_revenue: grossRevenue,
        total_orders: totalOrders,
        catalog_skus: products.length,
      },
      ads: adsData,
      couriers: couriersData,
      whatsapp: {
        total_conversations: conversations.length,
        voice_notes: voiceCount,
        orders_booked: whatsappOrders.length,
        revenue_generated: whatsappRevenue,
        conversion_rate: whatsappConversionRate,
      },
      shopify: {
        orders_count: shopifyOrders.length,
        revenue: shopifyRevenue,
        catalog_skus: products.length,
      },
    };
  },

  async recalculateStoreMetrics(storeId) {
    const db = readLocalDb();
    const orders = db.orders.filter((o) => o.store_id === storeId);
    const shipments = db.shipments.filter((s) => s.store_id === storeId);
    const adMetrics = db.ad_metrics.filter((a) => a.store_id === storeId);
    const products = db.products.filter((p) => p.store_id === storeId);

    const totalOrders = orders.length;
    const grossRevenue = orders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const cogs = orders.reduce((sum, o) => {
      const itemCost = (o.items || []).reduce((iSum, item) => iSum + (Number(item.price) || 0) * 0.4 * (item.quantity || 1), 0);
      return sum + itemCost;
    }, 0);

    const returnedShipments = shipments.filter((s) => s.status === 'returned');
    const rtoLoss = returnedShipments.reduce((sum, s) => sum + (Number(s.amount) || 0) * 0.15, 0);
    const courierFees = shipments.length * 250;
    const adSpend = adMetrics.reduce((sum, a) => sum + (Number(a.spend) || 0), 0);

    const netSales = Math.max(0, grossRevenue - rtoLoss);
    const netProfit = netSales - cogs - adSpend - courierFees;
    const netMarginPct = grossRevenue > 0 ? Math.round((netProfit / grossRevenue) * 1000) / 10 : 0;
    const aov = totalOrders > 0 ? Math.round(grossRevenue / totalOrders) : 0;
    const roas = adSpend > 0 ? Math.round((grossRevenue / adSpend) * 100) / 100 : 0;
    const cac = totalOrders > 0 && adSpend > 0 ? Math.round(adSpend / totalOrders) : 0;

    const hasData = totalOrders > 0 || grossRevenue > 0 || products.length > 0;

    const updatedMetrics = {
      id: crypto.randomUUID(),
      store_id: storeId,
      gross_revenue: grossRevenue,
      net_sales: netSales,
      rto_loss: rtoLoss,
      cogs: cogs,
      ad_spend: adSpend,
      courier_fees: courierFees,
      net_profit: netProfit,
      net_margin_pct: netMarginPct,
      total_orders: totalOrders,
      aov: aov,
      roas: roas,
      cac: cac,
      conversion_rate: totalOrders > 0 ? 3.2 : 0,
      has_sufficient_data: hasData,
      updated_at: new Date().toISOString(),
    };

    const index = db.metrics.findIndex((m) => m.store_id === storeId);
    if (index >= 0) {
      db.metrics[index] = { ...db.metrics[index], ...updatedMetrics };
    } else {
      db.metrics.push(updatedMetrics);
    }
    writeLocalDb(db);
    return updatedMetrics;
  },
};

module.exports = StoreService;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const DATA_DIR = path.join(__dirname, '../../data');
const LOCAL_STORES_FILE = process.env.STORES_DB_FILE || path.join(DATA_DIR, 'stores_db.json'); // tests point this at a temp copy

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
        support_channels: [],
        customers: [],
        conversations: [],
        conversation_messages: [],
        products: [],
        metrics: [],
        orders: [],
        shipments: [],
        ad_metrics: [],
      };
    }
    const raw = fs.readFileSync(LOCAL_STORES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.stores) data.stores = [];
    if (!data.integrations) data.integrations = [];
    if (!data.support_channels) data.support_channels = [];
    if (!data.customers) data.customers = [];
    if (!data.conversations) data.conversations = [];
    if (!data.conversation_messages) data.conversation_messages = [];
    if (!data.products) data.products = [];
    if (!data.metrics) data.metrics = [];
    if (!data.orders) data.orders = [];
    if (!data.shipments) data.shipments = [];
    if (!data.ad_metrics) data.ad_metrics = [];
    return data;
  } catch (err) {
    console.error('[StoreService] readLocalDb error:', err.message);
    return {
      stores: [],
      integrations: [],
      support_channels: [],
      customers: [],
      conversations: [],
      conversation_messages: [],
      products: [],
      metrics: [],
      orders: [],
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

const DEFAULT_PROVIDERS = [
  'shopify',
  'meta-ads',
  'google-ads',
  'tiktok-ads',
  'snapchat-ads',
  'whatsapp-business',
  'postex-courier',
  'trax-logistics',
  'leopards-courier',
  'tcs-courier',
  'call-courier',
  'mnp-courier',
  'rider-courier',
];

/**
 * Every store starts with nothing connected. (An earlier version pre-marked Meta, TikTok, PostEx,
 * Google and WhatsApp as "connected" on a user's first store as demo data; for a SaaS that told every
 * new customer they had integrations they never made.) Only real connections are ever "connected".
 */
function getDefaultIntegrations(storeId, userId, _isNewSubStore = true, storeDomain = '') {
  return DEFAULT_PROVIDERS.map((provider) => ({
    id: crypto.randomUUID(),
    store_id: storeId,
    user_id: userId,
    provider,
    status: 'not_connected',
    config: provider === 'shopify' && storeDomain ? { shop_domain: storeDomain } : {},
    last_synced_at: null,
  }));
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

  // ── Omnichannel Support Channels (DelightChat Style) ───────────────────────

  async getStoreSupportChannels(storeId) {
    const db = readLocalDb();
    const channels = db.support_channels.filter((c) => c.store_id === storeId);
    // Sanitize credentials from output
    return channels.map((c) => ({
      id: c.id,
      store_id: c.store_id,
      channel_type: c.channel_type,
      name: c.name,
      account_id: c.account_id,
      status: c.status,
      webhook_verified: !!c.webhook_verified,
      settings: c.settings || {},
      last_synced_at: c.last_synced_at,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));
  },

  async getSupportChannelById(storeId, channelId) {
    const db = readLocalDb();
    return db.support_channels.find((c) => c.id === channelId && c.store_id === storeId) || null;
  },

  async findSupportChannelByAccount(storeId, channelType, accountId) {
    const db = readLocalDb();
    return (
      db.support_channels.find(
        (c) =>
          c.store_id === storeId &&
          c.channel_type === channelType &&
          String(c.account_id).toLowerCase() === String(accountId).toLowerCase()
      ) || null
    );
  },

  async findSupportChannelGlobal(channelType, accountId) {
    const db = readLocalDb();
    return (
      db.support_channels.find(
        (c) =>
          c.channel_type === channelType &&
          String(c.account_id).toLowerCase() === String(accountId).toLowerCase()
      ) || null
    );
  },

  async findSupportChannelByInboundEmail(toAddress) {
    const db = readLocalDb();
    const cleanTo = (toAddress || '').toLowerCase();
    return (
      db.support_channels.find((c) => {
        if (c.channel_type !== 'email') return false;
        const inbound = c.settings?.inbound_address?.toLowerCase();
        const account = c.account_id?.toLowerCase();
        return (inbound && cleanTo.includes(inbound)) || (account && cleanTo.includes(account));
      }) || null
    );
  },

  readLocalDb() {
    return readLocalDb();
  },

  writeLocalDb(data) {
    return writeLocalDb(data);
  },

  async upsertSupportChannel(storeId, userId, channelData) {
    const db = readLocalDb();
    const cleanAccount = String(channelData.account_id || '').trim().toLowerCase();
    const index = db.support_channels.findIndex(
      (c) =>
        c.store_id === storeId &&
        c.channel_type === channelData.channel_type &&
        String(c.account_id || '').toLowerCase() === cleanAccount
    );

    const now = new Date().toISOString();
    const channelRecord = {
      id: index >= 0 ? db.support_channels[index].id : crypto.randomUUID(),
      store_id: storeId,
      user_id: userId,
      channel_type: channelData.channel_type,
      name: channelData.name || channelData.channel_type,
      account_id: channelData.account_id,
      status: channelData.status || 'connected',
      credentials_encrypted: channelData.credentials_encrypted || null,
      webhook_verified: channelData.webhook_verified !== undefined ? channelData.webhook_verified : true,
      settings: channelData.settings || {},
      last_synced_at: now,
      created_at: index >= 0 ? db.support_channels[index].created_at : now,
      updated_at: now,
    };

    if (index >= 0) {
      db.support_channels[index] = channelRecord;
    } else {
      db.support_channels.push(channelRecord);
    }

    writeLocalDb(db);
    return channelRecord;
  },

  async updateSupportChannel(storeId, channelId, updates) {
    const db = readLocalDb();
    const index = db.support_channels.findIndex((c) => c.id === channelId && c.store_id === storeId);
    if (index === -1) return null;

    db.support_channels[index] = {
      ...db.support_channels[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    writeLocalDb(db);
    return db.support_channels[index];
  },

  async deleteSupportChannel(storeId, channelId) {
    const db = readLocalDb();
    const index = db.support_channels.findIndex((c) => c.id === channelId && c.store_id === storeId);
    if (index >= 0) {
      const removed = db.support_channels.splice(index, 1)[0];
      writeLocalDb(db);
      return removed;
    }
    return null;
  },

  // ── Unified Customer Resolution Layer ──────────────────────────────────────

  async getStoreCustomers(storeId) {
    const db = readLocalDb();
    return db.customers.filter((c) => c.store_id === storeId);
  },

  async findCustomerById(storeId, customerId) {
    const db = readLocalDb();
    return db.customers.find((c) => c.id === customerId && c.store_id === storeId) || null;
  },

  /** Fill in a real name / avatar once the platform tells us who a placeholder customer is. */
  async updateCustomerProfile(storeId, customerId, { name, avatar_url } = {}) {
    const db = readLocalDb();
    const c = db.customers.find((x) => x.id === customerId && x.store_id === storeId);
    if (!c) return null;
    if (name) c.name = name;
    if (avatar_url) c.avatar_url = avatar_url;
    c.updated_at = new Date().toISOString();
    writeLocalDb(db);
    return c;
  },

  async findOrCreateCustomer(storeId, customerData) {
    const db = readLocalDb();
    const email = (customerData.email || '').trim().toLowerCase();
    const phone = (customerData.phone || customerData.whatsapp_phone || '').replace(/[^0-9]/g, '');
    const shopifyId = customerData.shopify_customer_id ? String(customerData.shopify_customer_id) : null;
    const psid = customerData.facebook_psid ? String(customerData.facebook_psid) : null;
    const igId = customerData.instagram_id ? String(customerData.instagram_id) : null;

    // Multi-identifier resolution
    let customer = db.customers.find((c) => {
      if (c.store_id !== storeId) return false;
      if (email && c.email && c.email.toLowerCase() === email) return true;
      if (phone && c.phone && c.phone.replace(/[^0-9]/g, '').includes(phone)) return true;
      if (phone && c.whatsapp_phone && c.whatsapp_phone.replace(/[^0-9]/g, '').includes(phone)) return true;
      if (shopifyId && String(c.shopify_customer_id) === shopifyId) return true;
      if (psid && String(c.facebook_psid) === psid) return true;
      if (igId && String(c.instagram_id) === igId) return true;
      return false;
    });

    const now = new Date().toISOString();

    if (customer) {
      // Update with any additional newly resolved identifiers
      let updated = false;
      if (email && !customer.email) { customer.email = email; updated = true; }
      if (phone && !customer.phone) { customer.phone = phone; updated = true; }
      if (customerData.whatsapp_phone && !customer.whatsapp_phone) { customer.whatsapp_phone = customerData.whatsapp_phone; updated = true; }
      if (shopifyId && !customer.shopify_customer_id) { customer.shopify_customer_id = shopifyId; updated = true; }
      if (psid && !customer.facebook_psid) { customer.facebook_psid = psid; updated = true; }
      if (igId && !customer.instagram_id) { customer.instagram_id = igId; updated = true; }
      if (customerData.name && (!customer.name || customer.name === 'Guest' || customer.name === 'Customer')) {
        customer.name = customerData.name;
        updated = true;
      }
      if (customerData.city && !customer.city) { customer.city = customerData.city; updated = true; }
      if (customerData.total_spent) { customer.total_spent = Number(customerData.total_spent); updated = true; }
      if (customerData.orders_count) { customer.orders_count = Number(customerData.orders_count); updated = true; }

      if (updated) {
        customer.updated_at = now;
        writeLocalDb(db);
      }
      return customer;
    }

    // Create new unified customer
    const newCustomer = {
      id: crypto.randomUUID(),
      store_id: storeId,
      name: customerData.name || 'Customer',
      email: email || null,
      phone: customerData.phone || customerData.whatsapp_phone || null,
      avatar_url: customerData.avatar_url || null,
      shopify_customer_id: shopifyId,
      facebook_psid: psid,
      instagram_id: igId,
      whatsapp_phone: customerData.whatsapp_phone || null,
      orders_count: Number(customerData.orders_count) || 0,
      total_spent: Number(customerData.total_spent) || 0,
      city: customerData.city || 'Karachi',
      metadata: customerData.metadata || {},
      created_at: now,
      updated_at: now,
    };

    db.customers.unshift(newCustomer);
    writeLocalDb(db);
    return newCustomer;
  },

  // ── Unified Omnichannel Conversations & Messages ──────────────────────────

  /**
   * Conversation list for the inbox. Each row carries a derived reply state:
   *   new      - nobody has replied yet
   *   replied  - the last message came from us (agent or AI)
   *   awaiting - the customer wrote again after our last reply
   * `unread` is separate: the customer has written something no agent has opened yet.
   */
  async getStoreConversations(storeId, filters = {}) {
    const db = readLocalDb();
    const msgsByConv = new Map();
    for (const m of db.conversation_messages) {
      if (m.store_id !== storeId || m.is_private_note) continue;
      const list = msgsByConv.get(m.conversation_id) || [];
      list.push(m);
      msgsByConv.set(m.conversation_id, list);
    }

    const rows = db.conversations
      .filter((c) => c.store_id === storeId)
      .map((conv) => {
        const msgs = (msgsByConv.get(conv.id) || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const last = msgs[msgs.length - 1];
        const hasReply = msgs.some((m) => m.sender_type === 'agent' || m.sender_type === 'ai');
        const replyState = !hasReply ? 'new' : last && last.sender_type !== 'customer' ? 'replied' : 'awaiting';
        const customer = conv.customer_id ? db.customers.find((c) => c.id === conv.customer_id) : null;
        const channel = conv.channel_id ? db.support_channels.find((ch) => ch.id === conv.channel_id) : null;
        return {
          ...conv,
          reply_state: replyState,
          unread: (conv.unread_count || 0) > 0,
          customer: customer || { name: 'Customer', email: '', phone: '' },
          channel: channel ? { name: channel.name, type: channel.channel_type, account_id: channel.account_id } : null,
        };
      });

    const group = (t) => (t === 'whatsapp' ? 'whatsapp' : t === 'email' ? 'email' : String(t).includes('comment') ? 'comments' : 'dms');
    const platform = (t) => (String(t).startsWith('facebook') ? 'facebook' : String(t).startsWith('instagram') ? 'instagram' : null);
    const counts = { all: rows.length, unread: 0, new: 0, replied: 0, by_channel: { whatsapp: 0, dms: 0, comments: 0, email: 0, facebook: 0, instagram: 0 } };
    for (const r of rows) {
      if (r.unread) counts.unread++;
      if (r.reply_state === 'new') counts.new++;
      if (r.reply_state === 'replied') counts.replied++;
      counts.by_channel[group(r.channel_type)]++;
      if (platform(r.channel_type)) counts.by_channel[platform(r.channel_type)]++;
    }

    let list = rows;
    if (filters.channel_type && filters.channel_type !== 'all') {
      list = list.filter((c) => c.channel_type === filters.channel_type || group(c.channel_type) === filters.channel_type || platform(c.channel_type) === filters.channel_type);
    }
    // Within a platform: only direct messages, or only comments
    if (filters.kind === 'messages') list = list.filter((c) => group(c.channel_type) === 'dms');
    else if (filters.kind === 'comments') list = list.filter((c) => group(c.channel_type) === 'comments');
    if (filters.status && filters.status !== 'all') list = list.filter((c) => c.status === filters.status);
    if (filters.state === 'unread') list = list.filter((c) => c.unread);
    else if (filters.state === 'new') list = list.filter((c) => c.reply_state === 'new');
    else if (filters.state === 'replied') list = list.filter((c) => c.reply_state === 'replied');
    if (filters.search) {
      const q = String(filters.search).toLowerCase();
      list = list.filter(
        (c) =>
          (c.subject && c.subject.toLowerCase().includes(q)) ||
          (c.last_message_preview && c.last_message_preview.toLowerCase().includes(q)) ||
          (c.customer && String(c.customer.name || '').toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => new Date(b.last_message_at || b.updated_at) - new Date(a.last_message_at || a.updated_at));
    return { conversations: list, counts };
  },

  async getConversationWithDetails(storeId, conversationId) {
    const db = readLocalDb();
    const conv = db.conversations.find((c) => c.id === conversationId && c.store_id === storeId);
    if (!conv) return null;

    const customer = conv.customer_id ? db.customers.find((c) => c.id === conv.customer_id) : null;
    const channel = conv.channel_id ? db.support_channels.find((ch) => ch.id === conv.channel_id) : null;
    const messages = db.conversation_messages
      .filter((m) => m.conversation_id === conversationId && m.store_id === storeId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Retrieve real Shopify orders for customer
    let shopifyContext = null;
    if (customer) {
      const customerOrders = db.orders.filter(
        (o) =>
          o.store_id === storeId &&
          ((customer.phone && o.customer_phone && o.customer_phone.includes(customer.phone.replace(/[^0-9]/g, ''))) ||
            (customer.email && o.customer_email && o.customer_email.toLowerCase() === customer.email.toLowerCase()))
      );

      const totalSpent = customerOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
      shopifyContext = {
        customer_id: customer.shopify_customer_id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        total_orders: customerOrders.length,
        total_spent: totalSpent,
        recent_orders: customerOrders.slice(0, 5),
      };
    }

    return {
      ...conv,
      customer,
      channel,
      messages,
      shopifyContext,
    };
  },

  async findOrCreateConversation(storeId, convData) {
    const db = readLocalDb();
    let conv = null;

    if (convData.external_thread_id) {
      conv = db.conversations.find(
        (c) => c.store_id === storeId && c.external_thread_id === String(convData.external_thread_id)
      );
    }

    if (!conv && convData.customer_id && convData.channel_type) {
      conv = db.conversations.find(
        (c) =>
          c.store_id === storeId &&
          c.customer_id === convData.customer_id &&
          c.channel_type === convData.channel_type &&
          c.status !== 'closed'
      );
    }

    const now = new Date().toISOString();

    if (!conv) {
      conv = {
        id: crypto.randomUUID(),
        store_id: storeId,
        channel_id: convData.channel_id || null,
        channel_type: convData.channel_type, // 'whatsapp', 'facebook_messenger', 'facebook_comment', 'facebook_ad_comment', 'instagram_dm', 'instagram_comment', 'instagram_ad_comment', 'email'
        customer_id: convData.customer_id || null,
        external_thread_id: convData.external_thread_id ? String(convData.external_thread_id) : null,
        subject: convData.subject || null,
        status: convData.status || 'open',
        priority: convData.priority || 'normal',
        assigned_agent: convData.assigned_agent || null,
        last_message_at: convData.created_at || now,
        last_message_preview: convData.last_message_preview || '',
        unread_count: convData.unread_count !== undefined ? convData.unread_count : 1,
        metadata: convData.metadata || {},
        created_at: convData.created_at || now,
        updated_at: convData.created_at || now,
      };
      db.conversations.unshift(conv);
      writeLocalDb(db);
    } else {
      if (convData.last_message_preview) {
        conv.last_message_preview = convData.last_message_preview;
        conv.last_message_at = now;
        conv.updated_at = now;
        if (convData.is_incoming) {
          conv.unread_count = (conv.unread_count || 0) + 1;
        }
        writeLocalDb(db);
      }
    }

    return conv;
  },

  async updateConversation(storeId, conversationId, updates) {
    const db = readLocalDb();
    const index = db.conversations.findIndex((c) => c.id === conversationId && c.store_id === storeId);
    if (index === -1) return null;

    db.conversations[index] = {
      ...db.conversations[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    writeLocalDb(db);
    return db.conversations[index];
  },

  async addConversationMessage(storeId, conversationId, messageData) {
    const db = readLocalDb();
    const convIndex = db.conversations.findIndex((c) => c.id === conversationId && c.store_id === storeId);
    if (convIndex === -1) {
      throw new Error(`Conversation ${conversationId} not found in store ${storeId}`);
    }

    const now = messageData.created_at || new Date().toISOString();
    const newMsg = {
      id: crypto.randomUUID(),
      store_id: storeId,
      conversation_id: conversationId,
      external_message_id: messageData.external_message_id ? String(messageData.external_message_id) : null,
      sender_type: messageData.sender_type, // 'customer', 'agent', 'ai', 'system'
      sender_name: messageData.sender_name || (messageData.sender_type === 'ai' ? 'Store AI' : 'Agent'),
      sender_id: messageData.sender_id || null,
      message_text: messageData.message_text || '',
      message_type: messageData.message_type || 'text',
      attachments: Array.isArray(messageData.attachments) ? messageData.attachments : [],
      status: messageData.status || 'delivered',
      is_private_note: !!messageData.is_private_note,
      metadata: messageData.metadata || {},
      created_at: now,
    };

    db.conversation_messages.push(newMsg);

    // Historical import (sync from the platform): keep the thread in order but do not touch unread state or notify.
    if (messageData.silent) {
      const c = db.conversations[convIndex];
      if (!c.last_message_at || new Date(now) >= new Date(c.last_message_at)) {
        c.last_message_at = now;
        c.last_message_preview = newMsg.message_text.slice(0, 140);
      }
      writeLocalDb(db);
      return newMsg;
    }

    // Update conversation preview
    db.conversations[convIndex].last_message_at = now;
    db.conversations[convIndex].last_message_preview = newMsg.message_text.slice(0, 140);
    db.conversations[convIndex].updated_at = now;
    if (messageData.sender_type === 'customer') {
      db.conversations[convIndex].unread_count = (db.conversations[convIndex].unread_count || 0) + 1;
      if (db.conversations[convIndex].status === 'resolved' || db.conversations[convIndex].status === 'closed') {
        db.conversations[convIndex].status = 'open'; // Reopen on customer reply
      }
    } else {
      db.conversations[convIndex].unread_count = 0; // Clear unread on agent/AI reply
    }

    writeLocalDb(db);

    // Emit realtime event via Socket.IO
    const { emitToStore } = require('./realtime.service');
    emitToStore(storeId, 'inbox:new_message', {
      storeId,
      conversationId,
      message: newMsg,
      conversation: db.conversations[convIndex],
    });

    return newMsg;
  },

  async getConversationMessages(storeId, conversationId) {
    const db = readLocalDb();
    return db.conversation_messages
      .filter((m) => m.conversation_id === conversationId && m.store_id === storeId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  },
};

module.exports = StoreService;

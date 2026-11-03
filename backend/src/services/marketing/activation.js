const axios = require('axios');
const crypto = require('crypto');
const { encrypt, decrypt } = require('../../utils/crypto');
const U = require('./util');
const Performance = require('./performance');
const Connections = require('../oauth/connections');

const AUDIENCES = [
  { id: 'cart_abandoners', name: 'Added to cart, did not buy', description: 'Visitors who added a product to cart in the last 30 days and have not purchased since.', assumed_recovery_pct: 8, source: 'pixel' },
  { id: 'checkout_abandoners', name: 'Started checkout, did not buy', description: 'Reached checkout in the last 30 days without purchasing.', assumed_recovery_pct: 12, source: 'pixel' },
  { id: 'product_viewers', name: 'Viewed a product, did not buy', description: 'Viewed a product page in the last 30 days without purchasing.', assumed_recovery_pct: 2, source: 'pixel' },
  { id: 'new_customers_30d', name: 'New customers (30 days)', description: 'First purchase in the last 30 days: good for a thank-you and second-order flow.', assumed_recovery_pct: 10, source: 'orders' },
  { id: 'lapsed_90d', name: 'Lapsed customers (90+ days)', description: 'Bought before but not in the last 90 days: win-back.', assumed_recovery_pct: 5, source: 'orders' },
  { id: 'vip', name: 'VIP / Champions', description: 'Top RFM segment: best candidates for early access and lookalike seeds.', assumed_recovery_pct: 20, source: 'orders' },
];

/** People we can actually reach: need an email or a phone. Anonymous visitors are counted but not exportable. */
function pixelAudience(storeId, stages, days = 30) {
  const data = U.db();
  const since = Date.now() - days * U.DAY;
  const byVisitor = new Map();
  for (const e of data.pixel_events) {
    if (e.store_id !== storeId) continue;
    const v = byVisitor.get(e.anonymous_id) || { email: '', phone: '', stages: new Set(), lastPurchase: 0, lastStage: 0 };
    if (e.email) v.email = e.email;
    if (e.phone) v.phone = e.phone;
    const t = new Date(e.ts).getTime();
    if (e.event === 'purchase') v.lastPurchase = Math.max(v.lastPurchase, t);
    if (stages.includes(e.event) && t >= since) {
      v.stages.add(e.event);
      v.lastStage = Math.max(v.lastStage, t);
    }
    byVisitor.set(e.anonymous_id, v);
  }
  const buyers = new Set(
    U.revenueOrders(data, storeId).flatMap((o) => [U.normEmail(o.customer_email), U.normPhone(o.customer_phone)]).filter(Boolean)
  );
  const members = [];
  let anonymous = 0;
  for (const v of byVisitor.values()) {
    if (v.stages.size === 0 || v.lastPurchase >= v.lastStage) continue; // bought after showing intent
    if ((v.email && buyers.has(v.email)) || (v.phone && buyers.has(v.phone))) continue;
    if (v.email || v.phone) members.push({ email: v.email, phone: v.phone, name: '' });
    else anonymous++;
  }
  return { members, anonymous };
}

function orderAudience(storeId, id) {
  const data = U.db();
  const orders = U.revenueOrders(data, storeId).filter((o) => U.customerKey(o));
  const today = U.ymd(new Date());
  const info = new Map();
  for (const o of orders) {
    const k = U.customerKey(o);
    const d = U.orderDay(o);
    const c = info.get(k) || { name: o.customer_name || '', email: U.normEmail(o.customer_email), phone: U.normPhone(o.customer_phone), first: d, last: d };
    if (d < c.first) c.first = d;
    if (d > c.last) c.last = d;
    info.set(k, c);
  }
  let members;
  if (id === 'new_customers_30d') members = [...info.values()].filter((c) => U.daysBetween(c.first, today) <= 30);
  else if (id === 'lapsed_90d') members = [...info.values()].filter((c) => U.daysBetween(c.last, today) >= 90);
  else {
    const vip = new Set(Performance.rfm(storeId)._members.filter((m) => m.segment === 'Champions').map((m) => m.key));
    members = [...info.entries()].filter(([k]) => vip.has(k)).map(([, v]) => v);
  }
  return { members: members.map((m) => ({ email: m.email, phone: m.phone, name: m.name })), anonymous: 0 };
}

function membersOf(storeId, id) {
  switch (id) {
    case 'cart_abandoners':
      return pixelAudience(storeId, ['add_to_cart']);
    case 'checkout_abandoners':
      return pixelAudience(storeId, ['checkout_started']);
    case 'product_viewers':
      return pixelAudience(storeId, ['product_view']);
    default:
      return orderAudience(storeId, id);
  }
}

function listAudiences(storeId) {
  const data = U.db();
  const orders = U.revenueOrders(data, storeId);
  const aov = orders.length ? orders.reduce((s, o) => s + U.num(o.total_amount), 0) / orders.length : 0;
  return AUDIENCES.map((a) => {
    const { members, anonymous } = membersOf(storeId, a.id);
    return {
      ...a,
      reachable: members.length,
      anonymous_visitors: anonymous,
      // An ESTIMATE: reachable people x store AOV x an assumed recovery rate. Shown with its assumption.
      estimated_impact: U.round(members.length * aov * (a.assumed_recovery_pct / 100)),
      aov: U.round(aov),
    };
  });
}

function exportAudience(storeId, id, format = 'csv') {
  const a = AUDIENCES.find((x) => x.id === id);
  if (!a) throw new Error('Unknown audience.');
  const { members } = membersOf(storeId, id);
  const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
  if (format === 'meta') {
    // Meta Custom Audience upload format: SHA-256 of normalized email and phone.
    const lines = ['email,phone'];
    for (const m of members) lines.push([m.email ? U.sha256(m.email) : '', m.phone ? U.sha256(m.phone) : ''].join(','));
    return { filename: `${id}-meta-hashed.csv`, body: lines.join('\n'), count: members.length };
  }
  const lines = ['email,phone,name'];
  for (const m of members) lines.push([esc(m.email), esc(m.phone), esc(m.name)].join(','));
  return { filename: `${id}.csv`, body: lines.join('\n'), count: members.length };
}

// ── Klaviyo ──────────────────────────────────────────────────────────────────

function klaviyoKey(storeId) {
  const store = U.db().stores.find((s) => s.id === storeId);
  const enc = store?.settings?.klaviyo?.api_key_encrypted;
  return enc ? decrypt(enc) : null;
}

const KLAVIYO_REVISION = '2024-10-15';

/** Auth headers for Klaviyo: OAuth bearer token when connected through "Connect", else the private API key. */
async function klaviyoHeaders(storeId) {
  const oauth = Connections.getIntegration(storeId, 'klaviyo');
  if (oauth && oauth.status === 'connected' && oauth.config?.accessToken_encrypted) {
    const token = await Connections.getValidAccessToken(storeId, null, 'klaviyo');
    return { Authorization: `Bearer ${token}`, revision: KLAVIYO_REVISION, accept: 'application/json' };
  }
  const key = klaviyoKey(storeId);
  if (!key) throw new Error('Connect Klaviyo first (Integrations, Klaviyo) or save a private API key.');
  return { Authorization: `Klaviyo-API-Key ${key}`, revision: KLAVIYO_REVISION, accept: 'application/json' };
}

function klaviyoConnected(storeId) {
  const oauth = Connections.getIntegration(storeId, 'klaviyo');
  return !!(oauth && oauth.status === 'connected') || !!klaviyoKey(storeId);
}

function saveKlaviyo(storeId, apiKey) {
  const data = U.db();
  const store = data.stores.find((s) => s.id === storeId);
  if (!store) throw new Error('Store not found.');
  store.settings = store.settings || {};
  store.settings.klaviyo = apiKey ? { api_key_encrypted: encrypt(String(apiKey).trim()), saved_at: new Date().toISOString() } : null;
  U.save(data);
  return { connected: !!apiKey };
}

async function klaviyoLists(storeId) {
  const headers = await klaviyoHeaders(storeId);
  try {
    const res = await axios.get('https://a.klaviyo.com/api/lists', { headers, timeout: 15000 });
    return (res.data?.data || []).map((l) => ({ id: l.id, name: l.attributes?.name }));
  } catch (err) {
    throw new Error(`Klaviyo: ${err.response?.data?.errors?.[0]?.detail || err.message}`);
  }
}

async function pushToKlaviyo(storeId, audienceId, listId) {
  const authHeaders = await klaviyoHeaders(storeId);
  const a = AUDIENCES.find((x) => x.id === audienceId);
  if (!a) throw new Error('Unknown audience.');
  const { members } = membersOf(storeId, audienceId);
  const withEmail = members.filter((m) => m.email);
  if (withEmail.length === 0) throw new Error('No members with an email address to send.');

  const body = {
    data: {
      type: 'profile-bulk-import-job',
      attributes: {
        profiles: {
          data: withEmail.slice(0, 10000).map((m) => ({
            type: 'profile',
            attributes: {
              email: m.email,
              ...(m.phone ? { phone_number: `+${m.phone}` } : {}),
              ...(m.name ? { first_name: m.name.split(' ')[0] } : {}),
              properties: { audience: a.name },
            },
          })),
        },
      },
      ...(listId ? { relationships: { lists: { data: [{ type: 'list', id: listId }] } } } : {}),
    },
  };
  try {
    await axios.post('https://a.klaviyo.com/api/profile-bulk-import-jobs/', body, {
      headers: { ...authHeaders, 'content-type': 'application/json' },
      timeout: 30000,
    });
    return { sent: withEmail.length, skipped_without_email: members.length - withEmail.length };
  } catch (err) {
    throw new Error(`Klaviyo: ${err.response?.data?.errors?.[0]?.detail || err.message}`);
  }
}

// ── Meta Conversions API (server-side purchase events) ───────────────────────

function capiConfig(storeId) {
  const store = U.db().stores.find((s) => s.id === storeId);
  const c = store?.settings?.capi;
  return c ? { pixel_id: c.pixel_id, test_event_code: c.test_event_code || '', has_token: !!c.access_token_encrypted, saved_at: c.saved_at } : null;
}

function saveCapi(storeId, { pixel_id, access_token, test_event_code }) {
  const data = U.db();
  const store = data.stores.find((s) => s.id === storeId);
  if (!store) throw new Error('Store not found.');
  store.settings = store.settings || {};
  const prev = store.settings.capi || {};
  if (!pixel_id) throw new Error('Meta Pixel ID is required.');
  store.settings.capi = {
    pixel_id: String(pixel_id).trim(),
    access_token_encrypted: access_token ? encrypt(String(access_token).trim()) : prev.access_token_encrypted,
    test_event_code: String(test_event_code || '').trim(),
    saved_at: new Date().toISOString(),
  };
  if (!store.settings.capi.access_token_encrypted) throw new Error('Conversions API access token is required.');
  U.save(data);
  return capiConfig(storeId);
}

/**
 * Send not-yet-sent purchases to Meta. event_id = order identifier, so if the browser pixel also
 * fires a Purchase with the same id, Meta de-duplicates the pair. Matching uses hashed email/phone
 * plus fbp/fbc captured by our pixel when available.
 */
async function sendPendingPurchases(storeId, { days = 7 } = {}) {
  const data = U.db();
  const store = data.stores.find((s) => s.id === storeId);
  const cfg = store?.settings?.capi;
  if (!cfg?.pixel_id || !cfg.access_token_encrypted) throw new Error('Save your Meta Pixel ID and Conversions API token first.');
  const token = decrypt(cfg.access_token_encrypted);

  const since = U.addDays(U.ymd(new Date()), -days);
  const sentIds = new Set(data.capi_sent.filter((s) => s.store_id === storeId).map((s) => s.order_id));
  const pixelPurchases = data.pixel_events.filter((e) => e.store_id === storeId && e.event === 'purchase');

  const events = [];
  const orderIds = [];
  for (const o of U.revenueOrders(data, storeId)) {
    if (U.orderDay(o) < since || sentIds.has(String(o.id))) continue;
    const em = U.normEmail(o.customer_email);
    const ph = U.normPhone(o.customer_phone);
    if (!em && !ph) continue; // Meta cannot match without at least one identifier
    const match = pixelPurchases.find((p) => p.order?.order_number && String(p.order.order_number) === String(o.shopify_order_id || o.order_number));
    const user = {
      ...(em ? { em: [U.sha256(em)] } : {}),
      ...(ph ? { ph: [U.sha256(ph)] } : {}),
      ...(match?.fbp ? { fbp: match.fbp } : {}),
      ...(match?.fbc ? { fbc: match.fbc } : {}),
    };
    events.push({
      event_name: 'Purchase',
      event_time: Math.floor(new Date(o.created_at || Date.now()).getTime() / 1000),
      event_id: String(o.shopify_order_id || o.order_number || o.id),
      action_source: 'website',
      user_data: user,
      custom_data: { value: U.num(o.total_amount), currency: store.currency || 'PKR', order_id: String(o.order_number || o.id) },
    });
    orderIds.push(String(o.id));
  }
  if (events.length === 0) return { sent: 0, message: 'No new purchases with email or phone to send.' };

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v20.0/${cfg.pixel_id}/events`,
      { data: events.slice(0, 1000), ...(cfg.test_event_code ? { test_event_code: cfg.test_event_code } : {}) },
      { params: { access_token: token }, timeout: 30000 }
    );
    const fresh = U.db();
    for (const id of orderIds.slice(0, 1000)) fresh.capi_sent.push({ id: crypto.randomUUID(), store_id: storeId, order_id: id, sent_at: new Date().toISOString() });
    U.save(fresh);
    return { sent: Math.min(events.length, 1000), events_received: res.data?.events_received ?? null, test_mode: !!cfg.test_event_code };
  } catch (err) {
    throw new Error(`Meta CAPI: ${err.response?.data?.error?.message || err.message}`);
  }
}

module.exports = {
  AUDIENCES,
  listAudiences,
  exportAudience,
  saveKlaviyo,
  klaviyoLists,
  pushToKlaviyo,
  klaviyoConnected,
  capiConfig,
  saveCapi,
  sendPendingPurchases,
};

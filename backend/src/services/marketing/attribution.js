const crypto = require('crypto');
const StoreService = require('../store.service');
const U = require('./util');

const EVENTS = new Set(['page_view', 'product_view', 'add_to_cart', 'checkout_started', 'purchase', 'identify']);
const LOOKBACK_DAYS = 30;
const HALF_LIFE_DAYS = 7;
const MODELS = ['last_click', 'first_click', 'linear', 'time_decay', 'position_based'];

// ── Pixel key & ingestion ────────────────────────────────────────────────────

async function getOrCreatePixelKey(storeId, userId, { rotate = false } = {}) {
  const data = U.db();
  const store = data.stores.find((s) => s.id === storeId);
  if (!store) throw new Error('Store not found.');
  store.settings = store.settings || {};
  if (!store.settings.pixel_key || rotate) {
    store.settings.pixel_key = `px_${crypto.randomBytes(12).toString('hex')}`;
    U.save(data);
  }
  return store.settings.pixel_key;
}

function storeIdForPixelKey(key) {
  const store = U.db().stores.find((s) => s.settings?.pixel_key && s.settings.pixel_key === key);
  return store ? store.id : null;
}

const clip = (v, n = 500) => (v === undefined || v === null ? undefined : String(v).slice(0, n));

function cleanEvent(e) {
  if (!e || !EVENTS.has(e.event)) return null;
  const ts = e.ts ? new Date(e.ts) : new Date();
  const safeTs = Number.isNaN(ts.getTime()) || Math.abs(ts - Date.now()) > 7 * U.DAY ? new Date() : ts;
  const out = {
    event_id: clip(e.event_id, 64) || crypto.randomUUID(),
    event: e.event,
    ts: safeTs.toISOString(),
    anonymous_id: clip(e.anonymous_id, 64),
    session_id: clip(e.session_id, 64),
    url: clip(e.url),
    referrer: clip(e.referrer),
    utm_source: clip(e.utm_source, 100),
    utm_medium: clip(e.utm_medium, 100),
    utm_campaign: clip(e.utm_campaign, 200),
    utm_content: clip(e.utm_content, 200),
    utm_term: clip(e.utm_term, 200),
    fbclid: clip(e.fbclid, 300),
    gclid: clip(e.gclid, 300),
    ttclid: clip(e.ttclid, 300),
    fbp: clip(e.fbp, 100),
    fbc: clip(e.fbc, 300),
  };
  if (!out.anonymous_id) return null;
  if (e.product && typeof e.product === 'object') {
    out.product = { id: clip(e.product.id, 80), title: clip(e.product.title, 200), price: U.num(e.product.price) };
  }
  if (e.order && typeof e.order === 'object') {
    out.order = { order_number: clip(e.order.order_number, 80), total: U.num(e.order.total), currency: clip(e.order.currency, 8) };
  }
  const email = U.normEmail(e.email);
  const phone = U.normPhone(e.phone);
  if (email) out.email = email;
  if (phone) out.phone = phone;
  return out;
}

/** Store a batch of events. Dedupes on event_id so retries / beacon duplicates are harmless. */
function ingest(storeId, events) {
  const data = U.db();
  const seen = new Set(data.pixel_events.filter((x) => x.store_id === storeId).slice(-5000).map((x) => x.event_id));
  let accepted = 0;
  for (const raw of (events || []).slice(0, 50)) {
    const ev = cleanEvent(raw);
    if (!ev || seen.has(ev.event_id)) continue;
    seen.add(ev.event_id);
    data.pixel_events.push({ store_id: storeId, ...ev });
    accepted++;
  }
  if (accepted) {
    // Keep the local JSON store bounded: retain the most recent 200k events overall.
    if (data.pixel_events.length > 200000) data.pixel_events = data.pixel_events.slice(-200000);
    U.save(data);
  }
  return accepted;
}

function pixelStatus(storeId) {
  const events = U.db().pixel_events.filter((e) => e.store_id === storeId);
  const since = Date.now() - U.DAY;
  const last = events[events.length - 1];
  const counts = {};
  for (const e of events) if (new Date(e.ts).getTime() >= since) counts[e.event] = (counts[e.event] || 0) + 1;
  return {
    total_events: events.length,
    last_event_at: last ? last.ts : null,
    last_24h: counts,
    receiving: last ? Date.now() - new Date(last.ts).getTime() < 3 * U.DAY : false,
  };
}

// ── Touch classification ─────────────────────────────────────────────────────

const SEARCH = /(google|bing|yahoo|duckduckgo|yandex)\./i;
const SOCIAL = /(facebook|instagram|fb|t\.co|twitter|x\.com|tiktok|pinterest|youtube|linkedin|snapchat)\./i;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

/** Classify a session's first touch into a channel + campaign. Paid click-ids win over UTM, UTM over referrer. */
function classifyTouch(ev, ownHost) {
  const src = (ev.utm_source || '').toLowerCase();
  const med = (ev.utm_medium || '').toLowerCase();
  const paid = /cpc|paid|ppc|cpm|ads?$|social_paid|display/.test(med);
  let channel = null;

  if (ev.fbclid || /^(facebook|fb|instagram|ig|meta)$/.test(src)) channel = paid || ev.fbclid ? 'meta-ads' : 'social-organic';
  else if (ev.gclid || /^google$/.test(src)) channel = ev.gclid || paid ? 'google-ads' : 'search-organic';
  else if (ev.ttclid || /tiktok/.test(src)) channel = ev.ttclid || paid ? 'tiktok-ads' : 'social-organic';
  else if (/snap/.test(src)) channel = 'snapchat-ads';
  else if (/klaviyo|email|newsletter|mailchimp/.test(src) || /email/.test(med)) channel = 'email';
  else if (/whatsapp|wa$/.test(src)) channel = 'whatsapp';
  else if (src) channel = paid ? 'other-paid' : 'referral';
  else {
    const host = hostOf(ev.referrer);
    if (!host || host === ownHost) channel = 'direct';
    else if (SEARCH.test(`${host}.`)) channel = 'search-organic';
    else if (SOCIAL.test(`${host}.`)) channel = 'social-organic';
    else channel = 'referral';
  }
  return { channel, campaign: ev.utm_campaign || (channel === 'direct' ? '(direct)' : '(none)') };
}

/**
 * Build per-visitor journeys: a list of sessions with their first-touch channel, plus purchases.
 */
function buildJourneys(storeId, ownHost, fromTs, toTs) {
  const events = U.db().pixel_events.filter((e) => e.store_id === storeId);
  const byVisitor = new Map();
  for (const e of events) {
    const v = byVisitor.get(e.anonymous_id) || { id: e.anonymous_id, sessions: new Map(), purchases: [], identities: new Set() };
    if (e.email) v.identities.add(`e:${e.email}`);
    if (e.phone) v.identities.add(`p:${e.phone}`);
    const sid = e.session_id || `${e.anonymous_id}-${e.ts.slice(0, 10)}`;
    if (!v.sessions.has(sid)) v.sessions.set(sid, { id: sid, ts: e.ts, events: [], first: e });
    const s = v.sessions.get(sid);
    s.events.push(e);
    if (e.ts < s.ts) {
      s.ts = e.ts;
      s.first = e;
    }
    if (e.event === 'purchase') v.purchases.push(e);
    byVisitor.set(e.anonymous_id, v);
  }

  for (const v of byVisitor.values()) {
    v.touches = [...v.sessions.values()]
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .map((s) => ({ ts: s.ts, session_id: s.id, ...classifyTouch(s.first, ownHost) }));
  }
  return byVisitor;
}

function creditsFor(touches, purchaseTs, model) {
  const t = touches.filter((x) => x.ts <= purchaseTs && new Date(purchaseTs) - new Date(x.ts) <= LOOKBACK_DAYS * U.DAY);
  if (t.length === 0) return [{ channel: 'direct', campaign: '(no tracked touch)', weight: 1 }];

  // Direct visits shouldn't steal credit from an earlier real marketing touch (standard last-non-direct rule).
  const marketing = t.filter((x) => x.channel !== 'direct');
  const use = marketing.length > 0 ? marketing : t;

  switch (model) {
    case 'first_click':
      return [{ ...use[0], weight: 1 }];
    case 'linear':
      return use.map((x) => ({ ...x, weight: 1 / use.length }));
    case 'time_decay': {
      const raw = use.map((x) => 2 ** (-((new Date(purchaseTs) - new Date(x.ts)) / U.DAY) / HALF_LIFE_DAYS));
      const sum = raw.reduce((a, b) => a + b, 0);
      return use.map((x, i) => ({ ...x, weight: raw[i] / sum }));
    }
    case 'position_based': {
      if (use.length === 1) return [{ ...use[0], weight: 1 }];
      if (use.length === 2) return use.map((x) => ({ ...x, weight: 0.5 }));
      const mid = 0.2 / (use.length - 2);
      return use.map((x, i) => ({ ...x, weight: i === 0 || i === use.length - 1 ? 0.4 : mid }));
    }
    case 'last_click':
    default:
      return [{ ...use[use.length - 1], weight: 1 }];
  }
}

function attribution(storeId, query = {}, ownHost = '') {
  const range = U.resolveRange(query);
  const model = MODELS.includes(query.model) ? query.model : 'time_decay';
  const journeys = buildJourneys(storeId, ownHost);
  const data = U.db();

  const rows = new Map(); // channel -> {channel, orders, revenue}
  const campaigns = new Map();
  const paths = new Map();
  let purchases = 0;
  let revenue = 0;
  let touchesSum = 0;
  let daysToPurchaseSum = 0;
  let pathCount = 0;

  for (const v of journeys.values()) {
    for (const p of v.purchases) {
      const day = U.ymd(p.ts);
      if (day < range.from || day > range.to) continue;
      const value = U.num(p.order?.total);
      purchases++;
      revenue += value;
      const credits = creditsFor(v.touches, p.ts, model);
      for (const c of credits) {
        const r = rows.get(c.channel) || { channel: c.channel, orders: 0, revenue: 0 };
        r.orders += c.weight;
        r.revenue += c.weight * value;
        rows.set(c.channel, r);
        const ck = `${c.channel}|${c.campaign}`;
        const cr = campaigns.get(ck) || { channel: c.channel, campaign: c.campaign, orders: 0, revenue: 0 };
        cr.orders += c.weight;
        cr.revenue += c.weight * value;
        campaigns.set(ck, cr);
      }
      const prior = v.touches.filter((x) => x.ts <= p.ts && new Date(p.ts) - new Date(x.ts) <= LOOKBACK_DAYS * U.DAY);
      if (prior.length) {
        const pathKey = prior.map((x) => x.channel).filter((ch, i, a) => i === 0 || ch !== a[i - 1]).join(' → ');
        paths.set(pathKey, (paths.get(pathKey) || 0) + 1);
        touchesSum += prior.length;
        daysToPurchaseSum += (new Date(p.ts) - new Date(prior[0].ts)) / U.DAY;
        pathCount++;
      }
    }
  }

  // Join spend so each channel gets an attribution-based ROAS / CAC.
  const spendByPlatform = new Map();
  for (const r of data.ad_spend_daily) {
    if (r.store_id !== storeId || r.date < range.from || r.date > range.to) continue;
    spendByPlatform.set(r.platform, (spendByPlatform.get(r.platform) || 0) + U.num(r.spend));
  }
  const platformClaims = new Map();
  for (const r of data.ad_spend_daily) {
    if (r.store_id !== storeId || r.date < range.from || r.date > range.to) continue;
    const c = platformClaims.get(r.platform) || { revenue: 0, conversions: 0 };
    c.revenue += U.num(r.revenue);
    c.conversions += U.num(r.conversions);
    platformClaims.set(r.platform, c);
  }

  const channels = [...new Set([...rows.keys(), ...spendByPlatform.keys()])].map((ch) => {
    const r = rows.get(ch) || { orders: 0, revenue: 0 };
    const spend = spendByPlatform.get(ch) || 0;
    const claim = platformClaims.get(ch);
    return {
      channel: ch,
      orders: U.round(r.orders, 1),
      revenue: U.round(r.revenue),
      spend: U.round(spend),
      roas: spend > 0 ? U.round(r.revenue / spend) : null,
      cac: spend > 0 && r.orders > 0 ? U.round(spend / r.orders) : null,
      platform_reported_revenue: claim ? U.round(claim.revenue) : null,
      platform_reported_roas: claim && spend > 0 ? U.round(claim.revenue / spend) : null,
      share_pct: revenue > 0 ? U.round((r.revenue / revenue) * 100, 1) : null,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const storeOrders = U.revenueOrders(data, storeId).filter((o) => {
    const d = U.orderDay(o);
    return d >= range.from && d <= range.to;
  });

  return {
    model,
    models: MODELS,
    range: { from: range.from, to: range.to },
    lookback_days: LOOKBACK_DAYS,
    tracked_purchases: purchases,
    tracked_revenue: U.round(revenue),
    store_orders: storeOrders.length,
    pixel_match_rate_pct: storeOrders.length ? U.round((purchases / storeOrders.length) * 100, 1) : null,
    avg_touches_before_purchase: pathCount ? U.round(touchesSum / pathCount, 1) : null,
    avg_days_to_purchase: pathCount ? U.round(daysToPurchaseSum / pathCount, 1) : null,
    channels,
    campaigns: [...campaigns.values()].map((c) => ({ ...c, orders: U.round(c.orders, 1), revenue: U.round(c.revenue) })).sort((a, b) => b.revenue - a.revenue).slice(0, 50),
    top_paths: [...paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([path, count]) => ({ path, purchases: count })),
  };
}

/** Visitor funnel by first-touch channel: sessions → product view → add to cart → checkout → purchase. */
function funnel(storeId, query = {}, ownHost = '') {
  const range = U.resolveRange(query);
  const journeys = buildJourneys(storeId, ownHost);
  const stages = ['sessions', 'product_view', 'add_to_cart', 'checkout_started', 'purchase'];
  const total = Object.fromEntries(stages.map((s) => [s, new Set()]));
  const byChannel = new Map();

  for (const v of journeys.values()) {
    for (const s of v.sessions.values()) {
      const day = U.ymd(s.ts);
      if (day < range.from || day > range.to) continue;
      const channel = classifyTouch(s.first, ownHost).channel;
      const ch = byChannel.get(channel) || Object.fromEntries(stages.map((x) => [x, new Set()]));
      byChannel.set(channel, ch);
      ch.sessions.add(s.id);
      total.sessions.add(s.id);
      for (const e of s.events) {
        if (ch[e.event]) {
          ch[e.event].add(s.id);
          total[e.event].add(s.id);
        }
      }
    }
  }

  const toRow = (name, sets) => {
    const counts = Object.fromEntries(stages.map((s) => [s, sets[s].size]));
    return {
      name,
      ...counts,
      conversion_rate_pct: counts.sessions ? U.round((counts.purchase / counts.sessions) * 100, 2) : null,
      add_to_cart_rate_pct: counts.sessions ? U.round((counts.add_to_cart / counts.sessions) * 100, 2) : null,
    };
  };

  return {
    range: { from: range.from, to: range.to },
    total: toRow('All traffic', total),
    channels: [...byChannel.entries()].map(([name, sets]) => toRow(name, sets)).sort((a, b) => b.sessions - a.sessions),
  };
}

// ── The storefront pixel script ──────────────────────────────────────────────

function pixelScript(key, collectUrl) {
  return `/* First-party store pixel */
(function () {
  if (window.__dbpixel) return;
  var KEY = ${JSON.stringify(key)}, URL_ = ${JSON.stringify(collectUrl)};
  var q = [], timer = null;
  function uid() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function cookie(n) { var m = document.cookie.match('(?:^|; )' + n + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : ''; }
  function setCookie(n, v, days) { document.cookie = n + '=' + encodeURIComponent(v) + ';max-age=' + days * 86400 + ';path=/;SameSite=Lax'; }
  var aid = cookie('_dbp_id') || uid(); setCookie('_dbp_id', aid, 730);
  var sid; try { var s = JSON.parse(sessionStorage.getItem('_dbp_s') || 'null'); if (s && Date.now() - s.t < 1800000) sid = s.id; } catch (e) {}
  if (!sid) sid = uid();
  function touchSession() { try { sessionStorage.setItem('_dbp_s', JSON.stringify({ id: sid, t: Date.now() })); } catch (e) {} }
  touchSession();
  var p = new URLSearchParams(location.search);
  var attr = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid'].forEach(function (k) { if (p.get(k)) attr[k] = p.get(k); });
  try { if (Object.keys(attr).length) sessionStorage.setItem('_dbp_a', JSON.stringify(attr)); else attr = JSON.parse(sessionStorage.getItem('_dbp_a') || '{}'); } catch (e) {}
  function send() {
    if (!q.length) return; var body = JSON.stringify({ key: KEY, events: q.splice(0, 50) });
    if (navigator.sendBeacon) { if (navigator.sendBeacon(URL_, body)) return; }
    fetch(URL_, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
  }
  function track(event, extra) {
    touchSession();
    var e = { event: event, event_id: uid(), ts: new Date().toISOString(), anonymous_id: aid, session_id: sid, url: location.href, referrer: document.referrer, fbp: cookie('_fbp'), fbc: cookie('_fbc') };
    for (var k in attr) e[k] = attr[k];
    for (var k2 in (extra || {})) e[k2] = extra[k2];
    q.push(e); clearTimeout(timer); timer = setTimeout(send, 400);
  }
  window.addEventListener('pagehide', send);
  window.__dbpixel = { track: track, identify: function (email, phone) { track('identify', { email: email, phone: phone }); } };
  window.dbpixel = window.__dbpixel;

  track('page_view');
  var S = window.Shopify || {};
  try {
    var meta = (window.ShopifyAnalytics && window.ShopifyAnalytics.meta) || {};
    if (meta.product) track('product_view', { product: { id: String(meta.product.id), title: meta.product.type || document.title, price: (meta.product.variants && meta.product.variants[0] ? meta.product.variants[0].price / 100 : 0) } });
    if (/\\/checkouts?\\//.test(location.pathname) && !(S.checkout && S.checkout.order_id)) track('checkout_started');
    if (S.checkout && S.checkout.order_id) {
      var c = S.checkout;
      track('purchase', { order: { order_number: String(c.order_id), total: Number(c.total_price), currency: c.currency }, email: c.email, phone: c.phone || (c.billing_address && c.billing_address.phone) });
    }
  } catch (e) {}
  // add-to-cart on Shopify themes goes through /cart/add.js
  var of = window.fetch;
  if (of) window.fetch = function (input) {
    try { var u = typeof input === 'string' ? input : input && input.url; if (u && /\\/cart\\/add/.test(u)) track('add_to_cart'); } catch (e) {}
    return of.apply(this, arguments);
  };
  var ox = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { try { if (u && /\\/cart\\/add/.test(u)) track('add_to_cart'); } catch (e) {} return ox.apply(this, arguments); };
  document.addEventListener('submit', function (ev) { try { var a = ev.target && ev.target.action; if (a && /\\/cart\\/add/.test(a)) track('add_to_cart'); } catch (e) {} }, true);
})();
`;
}

module.exports = {
  MODELS,
  getOrCreatePixelKey,
  storeIdForPixelKey,
  ingest,
  pixelStatus,
  attribution,
  funnel,
  pixelScript,
  classifyTouch,
};

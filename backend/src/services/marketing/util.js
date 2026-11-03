const crypto = require('crypto');
const StoreService = require('../store.service');

const DAY = 86400000;

const pad = (n) => String(n).padStart(2, '0');

/** UTC calendar day key, YYYY-MM-DD. All analytics use UTC days so buckets are stable. */
function ymd(input) {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dayStart(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDays(key, n) {
  return ymd(new Date(dayStart(key).getTime() + n * DAY));
}

function daysBetween(fromKey, toKey) {
  return Math.round((dayStart(toKey) - dayStart(fromKey)) / DAY);
}

/** Inclusive list of day keys from..to */
function eachDay(fromKey, toKey) {
  const out = [];
  for (let k = fromKey; k <= toKey; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Monday-start week key / month key / day key */
function bucketOf(dayKey, granularity) {
  if (granularity === 'month') return `${dayKey.slice(0, 7)}-01`;
  if (granularity === 'week') {
    const d = dayStart(dayKey);
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    return addDays(dayKey, -dow);
  }
  return dayKey;
}

/**
 * Resolve ?from&to into a day range. Default: last 30 complete-ish days ending today (UTC).
 */
function resolveRange(query = {}) {
  const today = ymd(new Date());
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : today;
  let from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : addDays(to, -29);
  if (from > to) from = to;
  // Hard cap so a bad query can't make us scan years of daily buckets.
  if (daysBetween(from, to) > 730) from = addDays(to, -730);
  const days = daysBetween(from, to) + 1;
  return { from, to, days, prevFrom: addDays(from, -days), prevTo: addDays(from, -1) };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeDiv(a, b) {
  return b > 0 ? a / b : null;
}

function round(v, dp = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function pctChange(curr, prev) {
  if (curr === null || prev === null || prev === 0 || curr === undefined || prev === undefined) return null;
  return round(((curr - prev) / Math.abs(prev)) * 100, 1);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normEmail(e) {
  const v = String(e || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : '';
}

/** Digits only, so +92 300 1234567 and 03001234567 hash/match the same way after country handling. */
function normPhone(p) {
  let d = String(p || '').replace(/[^0-9]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = `92${d.slice(1)}`; // PK local format
  return d.length >= 8 ? d : '';
}

/** Stable customer identity: email wins, then phone. Orders with neither return ''. */
function customerKey(order) {
  const e = normEmail(order.customer_email);
  if (e) return `e:${e}`;
  const p = normPhone(order.customer_phone);
  return p ? `p:${p}` : '';
}

function normCity(c) {
  return String(c || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function db() {
  const data = StoreService.readLocalDb();
  for (const k of ['ad_spend_daily', 'pixel_events', 'experiments', 'capi_sent']) {
    if (!Array.isArray(data[k])) data[k] = [];
  }
  return data;
}

function save(data) {
  StoreService.writeLocalDb(data);
}

/** Orders that count as revenue (cancelled orders are excluded). */
function revenueOrders(data, storeId) {
  return data.orders.filter((o) => o.store_id === storeId && o.order_status !== 'cancelled');
}

function orderDay(o) {
  return ymd(o.created_at || o.createdAt || Date.now());
}

function productCostMap(data, storeId) {
  const map = new Map();
  for (const p of data.products.filter((x) => x.store_id === storeId)) {
    map.set(p.id, p);
    if (p.sku) map.set(`sku:${p.sku}`, p);
  }
  return map;
}

/**
 * COGS of an order from the catalog's per-product cogs. Returns {cogs, knownItems, totalItems}
 * so callers can tell how much of the order was actually costed.
 */
function orderCogs(order, productMap) {
  let cogs = 0;
  let known = 0;
  let total = 0;
  for (const it of order.items || []) {
    const qty = num(it.quantity) || 1;
    total += qty;
    const p = productMap.get(it.product_id) || (it.sku ? productMap.get(`sku:${it.sku}`) : null);
    if (p && p.cogs !== undefined && p.cogs !== null && Number.isFinite(Number(p.cogs))) {
      cogs += Number(p.cogs) * qty;
      known += qty;
    }
  }
  return { cogs, known, total };
}

module.exports = {
  DAY,
  ymd,
  dayStart,
  addDays,
  daysBetween,
  eachDay,
  bucketOf,
  resolveRange,
  num,
  safeDiv,
  round,
  pctChange,
  sha256,
  normEmail,
  normPhone,
  customerKey,
  normCity,
  db,
  save,
  revenueOrders,
  orderDay,
  productCostMap,
  orderCogs,
};

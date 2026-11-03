const axios = require('axios');
const crypto = require('crypto');
const StoreService = require('../store.service');
const { decrypt } = require('../../utils/crypto');
const U = require('./util');

const PLATFORM_LABELS = {
  'meta-ads': 'Meta Ads',
  'google-ads': 'Google Ads',
  'tiktok-ads': 'TikTok Ads',
  'snapchat-ads': 'Snapchat Ads',
  'pinterest-ads': 'Pinterest Ads',
  'twitter-ads': 'X (Twitter) Ads',
  'bing-ads': 'Bing Ads',
  other: 'Other',
};

// ── Ad spend storage ─────────────────────────────────────────────────────────

function cleanSpendRow(storeId, row, source) {
  const platform = String(row.platform || 'other').toLowerCase();
  const date = String(row.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date "${row.date}" (use YYYY-MM-DD).`);
  const has = (k) => row[k] !== undefined && row[k] !== null && row[k] !== '';
  if (U.num(row.spend) < 0) throw new Error('Spend cannot be negative.');
  const out = {
    store_id: storeId,
    platform: PLATFORM_LABELS[platform] ? platform : 'other',
    date,
    campaign_id: String(row.campaign_id || row.campaign_name || 'all'),
    campaign_name: String(row.campaign_name || 'All campaigns').slice(0, 160),
    source,
  };
  // Only fields present in the row are set, so re-importing a spend-only file does not wipe revenue/clicks.
  if (has('spend')) out.spend = U.num(row.spend);
  if (has('impressions')) out.impressions = Math.round(U.num(row.impressions));
  if (has('clicks')) out.clicks = Math.round(U.num(row.clicks));
  if (has('conversions')) out.conversions = U.num(row.conversions); // platform-reported purchases
  if (has('revenue')) out.revenue = U.num(row.revenue); // platform-reported purchase value
  return out;
}

function upsertAdSpend(storeId, rows, source = 'manual') {
  const data = U.db();
  let inserted = 0;
  let updated = 0;
  for (const raw of rows) {
    const row = cleanSpendRow(storeId, raw, source);
    const idx = data.ad_spend_daily.findIndex(
      (r) =>
        r.store_id === storeId && r.platform === row.platform && r.date === row.date && r.campaign_id === row.campaign_id
    );
    if (idx >= 0) {
      data.ad_spend_daily[idx] = { ...data.ad_spend_daily[idx], ...row, updated_at: new Date().toISOString() };
      updated++;
    } else {
      data.ad_spend_daily.push({
        id: crypto.randomUUID(),
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        ...row,
        created_at: new Date().toISOString(),
      });
      inserted++;
    }
  }
  U.save(data);
  return { inserted, updated };
}

function listAdSpend(storeId, { from, to, platform } = {}) {
  return U.db().ad_spend_daily.filter(
    (r) =>
      r.store_id === storeId &&
      (!from || r.date >= from) &&
      (!to || r.date <= to) &&
      (!platform || platform === 'all' || r.platform === platform)
  );
}

function deleteAdSpendBySource(storeId, source) {
  const data = U.db();
  const before = data.ad_spend_daily.length;
  data.ad_spend_daily = data.ad_spend_daily.filter((r) => !(r.store_id === storeId && (!source || r.source === source)));
  U.save(data);
  return before - data.ad_spend_daily.length;
}

/**
 * Pull daily campaign-level insights from the Meta Marketing API using the credentials saved
 * by the "meta-ads" integration, and store them as ad spend rows.
 */
async function syncMetaAds(storeId, { days = 30 } = {}) {
  const integ = U.db().integrations.find((i) => i.store_id === storeId && i.provider === 'meta-ads');
  const cfg = integ?.config || {};
  const enc = cfg.accessToken_encrypted;
  if (!integ || integ.status !== 'connected' || !enc) {
    throw new Error('Connect Meta Ads in Integrations first.');
  }
  if (cfg.expires_at && new Date(cfg.expires_at).getTime() < Date.now()) {
    throw new Error('Your Meta connection expired. Reconnect Meta Ads in Integrations.');
  }
  // OAuth connections keep a list of accounts with a "selected" flag; older manual setups have one adAccountId.
  const selected = Array.isArray(cfg.accounts) ? cfg.accounts.filter((a) => a.selected).map((a) => a.id) : [];
  const accountIds = selected.length ? selected : cfg.adAccountId ? [cfg.adAccountId] : [];
  if (accountIds.length === 0) throw new Error('Choose at least one Meta ad account in Integrations.');

  const token = decrypt(enc);
  const version = process.env.META_GRAPH_VERSION || 'v20.0';
  const until = U.ymd(new Date());
  const since = U.addDays(until, -(Math.min(Math.max(days, 1), 365) - 1));

  const purchaseTypes = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
  const pick = (arr) => {
    for (const t of purchaseTypes) {
      const hit = (arr || []).find((a) => a.action_type === t);
      if (hit) return U.num(hit.value);
    }
    return 0;
  };

  const rows = [];
  for (const accountId of accountIds) {
    const act = String(accountId).startsWith('act_') ? accountId : `act_${accountId}`;
    let url = `https://graph.facebook.com/${version}/${act}/insights`;
    let params = {
      access_token: token,
      level: 'campaign',
      time_increment: 1,
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,date_start',
      time_range: JSON.stringify({ since, until }),
      limit: 500,
    };
    try {
      for (let page = 0; page < 40; page++) {
        const res = await axios.get(url, { params, timeout: 30000 });
        for (const r of res.data?.data || []) {
          rows.push({
            platform: 'meta-ads',
            date: r.date_start,
            campaign_id: r.campaign_id,
            campaign_name: r.campaign_name,
            spend: r.spend,
            impressions: r.impressions,
            clicks: r.clicks,
            conversions: pick(r.actions),
            revenue: pick(r.action_values),
          });
        }
        const next = res.data?.paging?.next;
        if (!next) break;
        url = next;
        params = undefined;
      }
    } catch (err) {
      throw new Error(`Meta insights sync failed for ${act}: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  const result = upsertAdSpend(storeId, rows, 'meta_api');
  const fresh = U.db();
  const rec = fresh.integrations.find((i) => i.store_id === storeId && i.provider === 'meta-ads');
  if (rec) {
    rec.last_synced_at = new Date().toISOString();
    U.save(fresh);
  }
  return { since, until, accounts: accountIds.length, rows: rows.length, ...result };
}

// ── Blended performance ──────────────────────────────────────────────────────

/** Map: customer key -> first order day, across the store's whole history. */
function firstOrderDays(orders) {
  const first = new Map();
  for (const o of orders) {
    const k = U.customerKey(o);
    if (!k) continue;
    const d = U.orderDay(o);
    if (!first.has(k) || d < first.get(k)) first.set(k, d);
  }
  return first;
}

function emptyBucket(key) {
  return { date: key, spend: 0, revenue: 0, orders: 0, new_customers: 0, new_customer_revenue: 0, cogs: 0, impressions: 0, clicks: 0 };
}

function derive(b) {
  const profit = b.revenue - b.cogs;
  return {
    ...b,
    spend: U.round(b.spend),
    revenue: U.round(b.revenue),
    cogs: U.round(b.cogs),
    profit: U.round(profit),
    aov: U.round(U.safeDiv(b.revenue, b.orders)),
    cac: U.round(U.safeDiv(b.spend, b.new_customers)), // spend per newly acquired customer
    mer: U.round(U.safeDiv(b.revenue, b.spend)), // blended ROAS = total revenue / total spend
    nc_roas: U.round(U.safeDiv(b.new_customer_revenue, b.spend)),
    poas: U.round(U.safeDiv(profit, b.spend)), // profit on ad spend = (revenue - COGS) / spend
    ctr: U.round(b.impressions > 0 ? (b.clicks / b.impressions) * 100 : null),
    cpc: U.round(U.safeDiv(b.spend, b.clicks)),
  };
}

function aggregate(storeId, data, orders, productMap, firstDay, from, to, granularity, platform) {
  const buckets = new Map();
  const get = (dayKey) => {
    const key = U.bucketOf(dayKey, granularity);
    if (!buckets.has(key)) buckets.set(key, emptyBucket(key));
    return buckets.get(key);
  };
  for (const d of U.eachDay(from, to)) get(d); // keep empty days so charts have no gaps

  let costedUnits = 0;
  let totalUnits = 0;

  for (const o of orders) {
    const day = U.orderDay(o);
    if (day < from || day > to) continue;
    const b = get(day);
    const rev = U.num(o.total_amount);
    const { cogs, known, total } = U.orderCogs(o, productMap);
    costedUnits += known;
    totalUnits += total;
    b.orders += 1;
    b.revenue += rev;
    b.cogs += cogs;
    const k = U.customerKey(o);
    // An order with no identifiable customer cannot be proven "returning", so it counts as new.
    if (!k || firstDay.get(k) === day) {
      b.new_customers += 1;
      b.new_customer_revenue += rev;
    }
  }

  for (const r of data.ad_spend_daily) {
    if (r.store_id !== storeId || r.date < from || r.date > to) continue;
    if (platform && platform !== 'all' && r.platform !== platform) continue;
    const b = get(r.date);
    b.spend += U.num(r.spend);
    b.impressions += U.num(r.impressions);
    b.clicks += U.num(r.clicks);
  }

  const raw = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  const series = raw.map(derive);
  const sum = emptyBucket('total');
  for (const b of raw) {
    for (const k of ['spend', 'revenue', 'orders', 'new_customers', 'new_customer_revenue', 'cogs', 'impressions', 'clicks']) sum[k] += b[k];
  }
  const totals = derive(sum);
  return { series, totals, cogs_coverage: totalUnits > 0 ? U.round(costedUnits / totalUnits, 3) : null };
}

function blended(storeId, query = {}) {
  const range = U.resolveRange(query);
  const granularity = ['day', 'week', 'month'].includes(query.granularity) ? query.granularity : 'day';
  const platform = query.platform || 'all';
  const data = U.db();
  const orders = U.revenueOrders(data, storeId);
  const productMap = U.productCostMap(data, storeId);
  const firstDay = firstOrderDays(orders);

  const cur = aggregate(storeId, data, orders, productMap, firstDay, range.from, range.to, granularity, platform);
  const prev = aggregate(storeId, data, orders, productMap, firstDay, range.prevFrom, range.prevTo, 'month', platform);

  const deltas = {};
  for (const k of ['spend', 'revenue', 'orders', 'new_customers', 'cac', 'mer', 'nc_roas', 'poas', 'aov', 'profit']) {
    deltas[k] = { previous: prev.totals[k], change_pct: U.pctChange(cur.totals[k], prev.totals[k]) };
  }

  const hasSpend = cur.totals.spend > 0;
  return {
    range: { from: range.from, to: range.to, days: range.days, previous_from: range.prevFrom, previous_to: range.prevTo },
    granularity,
    totals: cur.totals,
    deltas,
    series: cur.series,
    data_quality: {
      has_ad_spend: hasSpend,
      has_orders: cur.totals.orders > 0,
      cogs_coverage: cur.cogs_coverage,
      notes: [
        !hasSpend && 'No ad spend in this period. Connect Meta Ads, or import spend (CSV / manual), to see CAC, MER and POAS.',
        cur.cogs_coverage !== null && cur.cogs_coverage < 0.9 && 'Some products have no cost price (COGS), so profit and POAS are overstated.',
        'New customers are identified by email or phone; orders without either count as new.',
      ].filter(Boolean),
    },
  };
}

/** Per-platform and per-campaign spend table, including what each platform claims it drove. */
function channels(storeId, query = {}) {
  const range = U.resolveRange(query);
  const rows = listAdSpend(storeId, { from: range.from, to: range.to });
  const total = rows.reduce((s, r) => s + U.num(r.spend), 0);

  const byPlatform = new Map();
  const byCampaign = new Map();
  for (const r of rows) {
    const p = byPlatform.get(r.platform) || { platform: r.platform, label: PLATFORM_LABELS[r.platform], spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
    const c = byCampaign.get(`${r.platform}|${r.campaign_id}`) || { platform: r.platform, campaign_id: r.campaign_id, campaign_name: r.campaign_name, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
    for (const t of [p, c]) {
      t.spend += U.num(r.spend);
      t.impressions += U.num(r.impressions);
      t.clicks += U.num(r.clicks);
      t.conversions += U.num(r.conversions);
      t.revenue += U.num(r.revenue);
    }
    byPlatform.set(r.platform, p);
    byCampaign.set(`${r.platform}|${r.campaign_id}`, c);
  }

  const fin = (t) => ({
    ...t,
    spend: U.round(t.spend),
    revenue: U.round(t.revenue),
    spend_share_pct: total > 0 ? U.round((t.spend / total) * 100, 1) : null,
    platform_roas: U.round(U.safeDiv(t.revenue, t.spend)),
    cpc: U.round(U.safeDiv(t.spend, t.clicks)),
    ctr: U.round(t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null),
    cpm: U.round(t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null),
    cost_per_conversion: U.round(U.safeDiv(t.spend, t.conversions)),
  });

  return {
    range: { from: range.from, to: range.to },
    total_spend: U.round(total),
    platforms: [...byPlatform.values()].map(fin).sort((a, b) => b.spend - a.spend),
    campaigns: [...byCampaign.values()].map(fin).sort((a, b) => b.spend - a.spend).slice(0, 100),
  };
}

// ── Cohorts, LTV, RFM ────────────────────────────────────────────────────────

function monthIndex(dayKey) {
  const [y, m] = dayKey.split('-').map(Number);
  return y * 12 + (m - 1);
}

function cohorts(storeId, query = {}) {
  const data = U.db();
  const orders = U.revenueOrders(data, storeId).filter((o) => U.customerKey(o));
  const maxMonths = Math.min(Math.max(parseInt(query.months, 10) || 12, 3), 24);
  const customers = new Map(); // key -> { first, orders: [{day, rev}] }

  for (const o of orders) {
    const k = U.customerKey(o);
    const c = customers.get(k) || { first: null, orders: [] };
    const day = U.orderDay(o);
    c.orders.push({ day, rev: U.num(o.total_amount) });
    if (!c.first || day < c.first) c.first = day;
    customers.set(k, c);
  }

  const nowIdx = monthIndex(U.ymd(new Date()));
  const byCohort = new Map();
  for (const c of customers.values()) {
    const cohortKey = `${c.first.slice(0, 7)}`;
    const cohortIdx = monthIndex(c.first);
    const ch = byCohort.get(cohortKey) || { cohort: cohortKey, idx: cohortIdx, customers: 0, revenue_by_month: Array(maxMonths).fill(0), active_by_month: Array(maxMonths).fill(0) };
    ch.customers += 1;
    const activeMonths = new Set();
    for (const od of c.orders) {
      const m = monthIndex(od.day) - cohortIdx;
      if (m >= 0 && m < maxMonths) {
        ch.revenue_by_month[m] += od.rev;
        activeMonths.add(m);
      }
    }
    for (const m of activeMonths) ch.active_by_month[m] += 1;
    byCohort.set(cohortKey, ch);
  }

  const rows = [...byCohort.values()]
    .sort((a, b) => a.cohort.localeCompare(b.cohort))
    .slice(-maxMonths)
    .map((ch) => {
      const observable = Math.min(maxMonths, nowIdx - ch.idx + 1); // months that have actually happened
      let cum = 0;
      const ltv = [];
      const retention = [];
      for (let m = 0; m < maxMonths; m++) {
        if (m >= observable) {
          ltv.push(null);
          retention.push(null);
          continue;
        }
        cum += ch.revenue_by_month[m];
        ltv.push(U.round(cum / ch.customers));
        retention.push(U.round((ch.active_by_month[m] / ch.customers) * 100, 1));
      }
      return { cohort: ch.cohort, customers: ch.customers, ltv_by_month: ltv, retention_by_month: retention };
    });

  const all = [...customers.values()];
  const repeaters = all.filter((c) => c.orders.length > 1).length;
  const totalRev = all.reduce((s, c) => s + c.orders.reduce((x, o) => x + o.rev, 0), 0);
  return {
    months: maxMonths,
    cohorts: rows,
    summary: {
      identified_customers: all.length,
      repeat_rate_pct: all.length ? U.round((repeaters / all.length) * 100, 1) : null,
      avg_orders_per_customer: all.length ? U.round(orders.length / all.length) : null,
      avg_revenue_per_customer: all.length ? U.round(totalRev / all.length) : null,
    },
  };
}

function quintile(sortedAsc, value) {
  if (sortedAsc.length === 0) return 3;
  let below = 0;
  for (const v of sortedAsc) if (v <= value) below++;
  return Math.min(5, Math.max(1, Math.ceil((below / sortedAsc.length) * 5)));
}

function rfm(storeId) {
  const data = U.db();
  const orders = U.revenueOrders(data, storeId).filter((o) => U.customerKey(o));
  const today = U.ymd(new Date());
  const map = new Map();
  for (const o of orders) {
    const k = U.customerKey(o);
    const day = U.orderDay(o);
    const c = map.get(k) || { key: k, name: o.customer_name || '', email: U.normEmail(o.customer_email), phone: U.normPhone(o.customer_phone), last: day, frequency: 0, monetary: 0 };
    c.frequency += 1;
    c.monetary += U.num(o.total_amount);
    if (day > c.last) c.last = day;
    if (!c.name && o.customer_name) c.name = o.customer_name;
    map.set(k, c);
  }
  const list = [...map.values()].map((c) => ({ ...c, recency: U.daysBetween(c.last, today) }));
  const recencies = list.map((c) => -c.recency).sort((a, b) => a - b); // fewer days = higher score
  const freqs = list.map((c) => c.frequency).sort((a, b) => a - b);
  const mons = list.map((c) => c.monetary).sort((a, b) => a - b);

  const segmentOf = (r, f, m) => {
    if (r >= 4 && f >= 4 && m >= 4) return 'Champions';
    if (r >= 3 && f >= 3) return 'Loyal';
    if (r >= 4 && f <= 2) return 'New / Promising';
    if (r <= 2 && f >= 3) return 'At risk';
    if (r <= 2 && m >= 4) return "Can't lose";
    return 'Hibernating';
  };

  const segments = new Map();
  for (const c of list) {
    const r = quintile(recencies, -c.recency);
    const f = quintile(freqs, c.frequency);
    const m = quintile(mons, c.monetary);
    c.segment = segmentOf(r, f, m);
    const s = segments.get(c.segment) || { segment: c.segment, customers: 0, revenue: 0, orders: 0 };
    s.customers += 1;
    s.revenue += c.monetary;
    s.orders += c.frequency;
    segments.set(c.segment, s);
  }
  return {
    customers: list.length,
    segments: [...segments.values()]
      .map((s) => ({ ...s, revenue: U.round(s.revenue), avg_order_value: U.round(s.revenue / s.orders) }))
      .sort((a, b) => b.revenue - a.revenue),
    _members: list,
  };
}

// ── Product / merchandising performance ──────────────────────────────────────

function products(storeId, query = {}) {
  const range = U.resolveRange(query);
  const data = U.db();
  const productMap = U.productCostMap(data, storeId);
  const rows = new Map();
  let total = 0;

  for (const o of U.revenueOrders(data, storeId)) {
    const day = U.orderDay(o);
    if (day < range.from || day > range.to) continue;
    for (const it of o.items || []) {
      const qty = U.num(it.quantity) || 1;
      const p = productMap.get(it.product_id) || (it.sku ? productMap.get(`sku:${it.sku}`) : null);
      const key = p?.id || it.sku || it.title;
      const r = rows.get(key) || { product_id: p?.id || null, title: it.title || p?.title || 'Unknown', image_url: it.image_url || p?.image_url || null, units: 0, revenue: 0, cogs: 0, costed: false, stock: p ? U.num(p.stock) : null };
      const line = U.num(it.price) * qty;
      r.units += qty;
      r.revenue += line;
      total += line;
      if (p && p.cogs !== undefined && p.cogs !== null) {
        r.cogs += Number(p.cogs) * qty;
        r.costed = true;
      }
      rows.set(key, r);
    }
  }

  const out = [...rows.values()]
    .map((r) => {
      const profit = r.revenue - r.cogs;
      return {
        ...r,
        revenue: U.round(r.revenue),
        cogs: r.costed ? U.round(r.cogs) : null,
        profit: r.costed ? U.round(profit) : null,
        margin_pct: r.costed && r.revenue > 0 ? U.round((profit / r.revenue) * 100, 1) : null,
        revenue_share_pct: total > 0 ? U.round((r.revenue / total) * 100, 1) : null,
        days_of_stock: r.stock !== null && r.units > 0 ? U.round(r.stock / (r.units / range.days), 0) : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  return { range: { from: range.from, to: range.to }, products: out.slice(0, 100) };
}

// ── Alerts: anomaly detection on the daily series ────────────────────────────

function mean(a) {
  return a.reduce((s, v) => s + v, 0) / (a.length || 1);
}
function std(a) {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(a.length - 1, 1));
}

function alerts(storeId) {
  const to = U.ymd(new Date());
  const b = blended(storeId, { from: U.addDays(to, -35), to, granularity: 'day' });
  const days = b.series;
  const recent = days.slice(-3);
  const base = days.slice(0, -3);
  const out = [];

  const check = (metric, label, higherIsBad, minBase = 14) => {
    const baseVals = base.map((d) => d[metric]).filter((v) => v !== null);
    const recentVals = recent.map((d) => d[metric]).filter((v) => v !== null);
    if (baseVals.length < minBase || recentVals.length === 0) return;
    const m = mean(baseVals);
    const s = std(baseVals);
    if (!(s > 0) || !(m > 0)) return;
    const r = mean(recentVals);
    const z = (r - m) / s;
    if (Math.abs(z) < 2) return;
    const worse = higherIsBad ? z > 0 : z < 0;
    out.push({
      metric,
      label,
      severity: worse ? (Math.abs(z) >= 3 ? 'critical' : 'warning') : 'info',
      direction: z > 0 ? 'up' : 'down',
      recent_avg: U.round(r),
      baseline_avg: U.round(m),
      change_pct: U.pctChange(r, m),
      z_score: U.round(z, 1),
      message: `${label} is ${z > 0 ? 'up' : 'down'} ${Math.abs(U.pctChange(r, m))}% over the last 3 days vs the prior 4 weeks (${worse ? 'worse' : 'better'} than normal).`,
    });
  };

  check('spend', 'Ad spend', true);
  check('mer', 'Blended ROAS (MER)', false);
  check('orders', 'Daily orders', false);
  check('cac', 'CAC', true);
  check('revenue', 'Daily revenue', false);
  return { generated_at: new Date().toISOString(), alerts: out, checked_days: days.length };
}

module.exports = {
  PLATFORM_LABELS,
  upsertAdSpend,
  listAdSpend,
  deleteAdSpendBySource,
  syncMetaAds,
  blended,
  channels,
  cohorts,
  rfm,
  products,
  alerts,
};

const crypto = require('crypto');
const U = require('./util');

/**
 * Geo-holdout incrementality.
 *
 * Design: pick treatment cities that stay exposed to the channel and control cities where it is
 * switched off for the test window. Before the test, treatment orders move together with control
 * orders; we fit that relationship (OLS) on the pre-period, predict what treatment WOULD have been
 * without the change (the counterfactual), and the gap during the test is the incremental effect.
 */

const METRICS = {
  orders: { label: 'Orders', value: (o) => 1 },
  revenue: { label: 'Revenue', value: (o) => U.num(o.total_amount) },
};

// ── tiny stats helpers ───────────────────────────────────────────────────────

function mean(a) {
  return a.reduce((s, v) => s + v, 0) / (a.length || 1);
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Two-sided t critical value for 95%: lookup for small df, ~1.96 beyond. */
function tCrit(df) {
  const table = { 1: 12.71, 2: 4.3, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26, 10: 2.23, 12: 2.18, 15: 2.13, 20: 2.09, 25: 2.06, 30: 2.04, 40: 2.02, 60: 2.0 };
  if (df >= 120) return 1.98;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (df <= k) return table[k];
  return 1.98;
}

function ols(x, y) {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
    syy += (y[i] - my) ** 2;
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  const a = my - b * mx;
  let sse = 0;
  const resid = [];
  for (let i = 0; i < n; i++) {
    const r = y[i] - (a + b * x[i]);
    resid.push(r);
    sse += r * r;
  }
  const df = Math.max(n - 2, 1);
  const sigma = Math.sqrt(sse / df);
  const r2 = syy > 0 ? 1 - sse / syy : 0;
  return { a, b, mx, sxx, n, sigma, r2, resid, df };
}

function lag1Autocorr(r) {
  if (r.length < 4) return 0;
  const m = mean(r);
  let num = 0;
  let den = 0;
  for (let i = 0; i < r.length; i++) {
    den += (r[i] - m) ** 2;
    if (i > 0) num += (r[i] - m) * (r[i - 1] - m);
  }
  return den > 0 ? num / den : 0;
}

// ── data ─────────────────────────────────────────────────────────────────────

function citySeries(storeId, metricKey, from, to) {
  const data = U.db();
  const metric = METRICS[metricKey] || METRICS.orders;
  const byCity = new Map(); // city -> Map(day -> value)
  for (const o of U.revenueOrders(data, storeId)) {
    const day = U.orderDay(o);
    if (day < from || day > to) continue;
    const city = U.normCity(o.city) || '(unknown)';
    const m = byCity.get(city) || new Map();
    m.set(day, (m.get(day) || 0) + metric.value(o));
    byCity.set(city, m);
  }
  return byCity;
}

function sumSeries(byCity, cities, days) {
  return days.map((d) => cities.reduce((s, c) => s + (byCity.get(c)?.get(d) || 0), 0));
}

function cityVolumes(storeId, days = 90) {
  const to = U.ymd(new Date());
  const from = U.addDays(to, -(days - 1));
  const byCity = citySeries(storeId, 'orders', from, to);
  return [...byCity.entries()]
    .map(([city, m]) => ({ city, orders: [...m.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.orders - a.orders);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

function statusOf(exp, today = U.ymd(new Date())) {
  if (today < exp.start_date) return 'scheduled';
  if (today <= exp.end_date) return 'running';
  return 'completed';
}

function listExperiments(storeId) {
  return U.db()
    .experiments.filter((e) => e.store_id === storeId)
    .map((e) => ({ ...e, status: statusOf(e) }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function createExperiment(storeId, input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Experiment name is required.');
  const start = String(input.start_date || '');
  const end = String(input.end_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('Start and end dates (YYYY-MM-DD) are required.');
  if (end < start) throw new Error('End date must be after start date.');
  const treatment = (input.treatment_cities || []).map(U.normCity).filter(Boolean);
  const control = (input.control_cities || []).map(U.normCity).filter(Boolean);
  if (treatment.length === 0 || control.length === 0) throw new Error('Pick at least one treatment city and one control city.');
  if (treatment.some((c) => control.includes(c))) throw new Error('A city cannot be in both treatment and control.');
  if (!METRICS[input.metric || 'orders']) throw new Error('Metric must be "orders" or "revenue".');

  const exp = {
    id: crypto.randomUUID(),
    store_id: storeId,
    name: name.slice(0, 120),
    platform: String(input.platform || 'meta-ads'),
    metric: input.metric || 'orders',
    hypothesis: String(input.hypothesis || '').slice(0, 500),
    start_date: start,
    end_date: end,
    pre_period_days: Math.min(Math.max(parseInt(input.pre_period_days, 10) || 28, 14), 120),
    treatment_cities: [...new Set(treatment)],
    control_cities: [...new Set(control)],
    created_at: new Date().toISOString(),
  };
  const data = U.db();
  data.experiments.push(exp);
  U.save(data);
  return { ...exp, status: statusOf(exp) };
}

function deleteExperiment(storeId, id) {
  const data = U.db();
  const before = data.experiments.length;
  data.experiments = data.experiments.filter((e) => !(e.store_id === storeId && e.id === id));
  U.save(data);
  return before !== data.experiments.length;
}

// ── analysis ─────────────────────────────────────────────────────────────────

function analyze(storeId, expId) {
  const data = U.db();
  const exp = data.experiments.find((e) => e.store_id === storeId && e.id === expId);
  if (!exp) throw new Error('Experiment not found.');

  const today = U.ymd(new Date());
  const testEnd = exp.end_date < today ? exp.end_date : today;
  const preFrom = U.addDays(exp.start_date, -exp.pre_period_days);
  const preTo = U.addDays(exp.start_date, -1);
  const result = { experiment: { ...exp, status: statusOf(exp) }, ready: false, issues: [] };

  if (testEnd < exp.start_date) {
    result.issues.push('The experiment has not started yet.');
    return result;
  }

  const byCity = citySeries(storeId, exp.metric, preFrom, testEnd);
  const preDays = U.eachDay(preFrom, preTo);
  const testDays = U.eachDay(exp.start_date, testEnd);

  const yPre = sumSeries(byCity, exp.treatment_cities, preDays);
  const xPre = sumSeries(byCity, exp.control_cities, preDays);
  const yTest = sumSeries(byCity, exp.treatment_cities, testDays);
  const xTest = sumSeries(byCity, exp.control_cities, testDays);

  const activePre = yPre.filter((v, i) => v > 0 || xPre[i] > 0).length;
  if (activePre < 14 || xPre.every((v) => v === 0) || yPre.every((v) => v === 0)) {
    result.issues.push('Not enough order history in the pre-period (need at least 14 days with orders in both groups).');
    return result;
  }
  if (testDays.length < 3) {
    result.issues.push('Only a few test days so far; results are not meaningful yet.');
  }

  const fit = ols(xPre, yPre);
  const Z = tCrit(fit.df);
  const rows = testDays.map((d, i) => {
    const cf = Math.max(0, fit.a + fit.b * xTest[i]);
    const se = fit.sigma * Math.sqrt(1 + 1 / fit.n + (fit.sxx > 0 ? (xTest[i] - fit.mx) ** 2 / fit.sxx : 0));
    return { date: d, actual: yTest[i], counterfactual: U.round(cf), lower: U.round(Math.max(0, cf - Z * se)), upper: U.round(cf + Z * se), diff: U.round(yTest[i] - cf), control: xTest[i] };
  });

  // Same predicted-vs-actual view for the pre-period so the chart shows how well the model tracked reality.
  const preRows = preDays.map((d, i) => ({ date: d, actual: yPre[i], counterfactual: U.round(Math.max(0, fit.a + fit.b * xPre[i])) }));

  const T = testDays.length;
  const sumActual = yTest.reduce((a, b) => a + b, 0);
  const sumCf = rows.reduce((s, r) => s + r.counterfactual, 0);
  const incremental = sumActual - sumCf;
  // Variance of a sum of T prediction errors; independence assumed, which is optimistic when residuals autocorrelate.
  const sdSum = fit.sigma * Math.sqrt(T + (fit.sxx > 0 ? (T * T * (mean(xTest) - fit.mx) ** 2) / fit.sxx : 0) + T * T / fit.n);
  const z = sdSum > 0 ? incremental / sdSum : 0;
  const pValue = 2 * (1 - normCdf(Math.abs(z)));
  const ci = [incremental - Z * sdSum, incremental + Z * sdSum];
  const ac1 = lag1Autocorr(fit.resid);

  // Money: incremental revenue + iROAS vs the platform's spend over the test window (store-wide spend, see note).
  let incrementalRevenue = null;
  if (exp.metric === 'revenue') {
    incrementalRevenue = incremental;
  } else {
    const tOrders = U.revenueOrders(data, storeId).filter((o) => {
      const d = U.orderDay(o);
      return d >= exp.start_date && d <= testEnd && exp.treatment_cities.includes(U.normCity(o.city));
    });
    const aov = tOrders.length ? tOrders.reduce((s, o) => s + U.num(o.total_amount), 0) / tOrders.length : 0;
    incrementalRevenue = incremental * aov;
  }
  const spend = data.ad_spend_daily
    .filter((r) => r.store_id === storeId && r.platform === exp.platform && r.date >= exp.start_date && r.date <= testEnd)
    .reduce((s, r) => s + U.num(r.spend), 0);

  const controlShare = mean(xPre) / Math.max(mean(xPre) + mean(yPre), 1e-9);
  const validity = [
    { metric: 'Pre-period length', value: `${exp.pre_period_days} days`, status: exp.pre_period_days >= 28 ? 'OK' : 'Warning' },
    { metric: 'Pre-period fit (R²)', value: U.round(fit.r2, 2), status: fit.r2 >= 0.6 ? 'OK' : 'Warning' },
    { metric: 'Residual autocorrelation (lag 1)', value: U.round(ac1, 2), status: Math.abs(ac1) < 0.3 ? 'OK' : 'Warning' },
    { metric: 'Control share of volume', value: `${U.round(controlShare * 100, 0)}%`, status: controlShare >= 0.2 ? 'OK' : 'Warning' },
    { metric: 'Test days observed', value: T, status: T >= 7 ? 'OK' : 'Warning' },
    { metric: 'Pre-period days with orders', value: `${activePre}/${preDays.length}`, status: activePre >= preDays.length * 0.7 ? 'OK' : 'Warning' },
  ];

  Object.assign(result, {
    ready: true,
    metric_label: METRICS[exp.metric].label,
    windows: { pre: { from: preFrom, to: preTo }, test: { from: exp.start_date, to: testEnd } },
    pre_series: preRows,
    series: rows,
    summary: {
      actual_total: U.round(sumActual),
      counterfactual_total: U.round(sumCf),
      incremental_total: U.round(incremental),
      relative_lift_pct: sumCf > 0 ? U.round((incremental / sumCf) * 100, 1) : null,
      ci95: [U.round(ci[0]), U.round(ci[1])],
      z_score: U.round(z, 2),
      p_value: U.round(pValue, 4),
      significant: pValue < 0.05,
      incremental_revenue: U.round(incrementalRevenue),
      platform_spend: U.round(spend),
      iroas: spend > 0 && incrementalRevenue !== null ? U.round(incrementalRevenue / spend) : null,
    },
    validity,
    notes: [
      'Platform spend is the store-wide spend on this platform during the test; if it was only paused in control cities, iROAS is understated.',
      'p-values assume independent daily errors. If autocorrelation is flagged, treat significance as optimistic.',
    ],
  });
  return result;
}

/** Suggest a balanced treatment/control split and the smallest lift it could detect. */
function suggestDesign(storeId, { duration_days = 21, pre_days = 56 } = {}) {
  const volumes = cityVolumes(storeId, pre_days).filter((c) => c.city !== '(unknown)');
  if (volumes.length < 4) {
    return { feasible: false, reason: 'Need orders from at least 4 cities in the last 8 weeks to run a geo test.', cities: volumes };
  }
  // Greedy balancing: walk cities from largest to smallest and give each to the lighter group.
  let t = 0;
  let c = 0;
  const treatment = [];
  const control = [];
  for (const v of volumes) {
    if (t <= c) {
      treatment.push(v.city);
      t += v.orders;
    } else {
      control.push(v.city);
      c += v.orders;
    }
  }

  const to = U.ymd(new Date());
  const from = U.addDays(to, -(pre_days - 1));
  const days = U.eachDay(from, to);
  const byCity = citySeries(storeId, 'orders', from, to);
  const y = sumSeries(byCity, treatment, days);
  const x = sumSeries(byCity, control, days);
  const fit = ols(x, y);
  const meanY = mean(y);
  const T = Math.max(7, duration_days);
  // Minimum detectable lift at 80% power / 5% significance: (1.96 + 0.84) * sd(sum of T errors) / expected total.
  const mde = meanY > 0 ? ((1.96 + 0.84) * fit.sigma * Math.sqrt(T)) / (meanY * T) : null;
  return {
    feasible: true,
    cities: volumes,
    treatment_cities: treatment,
    control_cities: control,
    treatment_daily_orders: U.round(meanY, 1),
    control_daily_orders: U.round(mean(x), 1),
    fit_r2: U.round(fit.r2, 2),
    duration_days: T,
    min_detectable_lift_pct: mde === null ? null : U.round(mde * 100, 1),
    guidance:
      mde !== null && mde > 0.25
        ? 'Daily orders are noisy or low, so only large effects would be detectable. Run longer or use fewer, larger cities.'
        : 'Design looks usable. Switch the channel off in the control cities for the whole test window.',
  };
}

module.exports = { listExperiments, createExperiment, deleteExperiment, analyze, suggestDesign, cityVolumes };

const StoreService = require('../services/store.service');
const Performance = require('../services/marketing/performance');
const Attribution = require('../services/marketing/attribution');
const Incrementality = require('../services/marketing/incrementality');
const Activation = require('../services/marketing/activation');
const Connectors = require('../services/marketing/connectors');
const Ask = require('../services/marketing/ask');

/**
 * Wrap a handler: verify the signed-in user owns :storeId, pass the store in, map thrown
 * Errors to a 400 (validation / user-fixable) so the UI can show the message.
 */
const owned = (fn) => async (req, res, next) => {
  try {
    const store = await StoreService.getStoreById(req.params.storeId, req.user.id);
    if (!store) return res.status(403).json({ success: false, error: 'Access denied: Store does not belong to your account.' });
    const out = await fn(req, res, store);
    if (out !== undefined && !res.headersSent) return res.status(200).json({ success: true, ...out });
  } catch (err) {
    if (err && err.message && !err.statusCode) return res.status(400).json({ success: false, error: err.message });
    next(err);
  }
};

const ownHost = (store) => String(store.domain || store.settings?.shop_domain || '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();

const MarketingController = {
  // ── Performance ──
  blended: owned(async (req) => ({ data: Performance.blended(req.params.storeId, req.query) })),
  channels: owned(async (req) => ({ data: Performance.channels(req.params.storeId, req.query) })),
  cohorts: owned(async (req) => ({ data: Performance.cohorts(req.params.storeId, req.query) })),
  rfm: owned(async (req) => {
    const { _members, ...rest } = Performance.rfm(req.params.storeId);
    return { data: rest };
  }),
  products: owned(async (req) => ({ data: Performance.products(req.params.storeId, req.query) })),
  alerts: owned(async (req) => ({ data: Performance.alerts(req.params.storeId) })),

  // ── Ad spend ──
  listAdSpend: owned(async (req) => ({ data: Performance.listAdSpend(req.params.storeId, req.query).slice(-2000) })),
  importAdSpend: owned(async (req) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length === 0) throw new Error('No rows to import.');
    if (rows.length > 20000) throw new Error('Import at most 20,000 rows at a time.');
    return { data: Performance.upsertAdSpend(req.params.storeId, rows, req.body.source === 'csv' ? 'csv' : 'manual') };
  }),
  clearAdSpend: owned(async (req) => ({ data: { removed: Performance.deleteAdSpendBySource(req.params.storeId, req.query.source || null) } })),
  syncMeta: owned(async (req) => ({ data: await Performance.syncMetaAds(req.params.storeId, { days: parseInt(req.body.days, 10) || 30 }) })),

  // ── Pixel & attribution ──
  getPixel: owned(async (req, res, store) => {
    const key = await Attribution.getOrCreatePixelKey(store.id, req.user.id);
    const base = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    const src = `${base}/api/pixel/${key}.js`;
    return { data: { key, script_url: src, snippet: `<script async src="${src}"></script>`, status: Attribution.pixelStatus(store.id) } };
  }),
  rotatePixel: owned(async (req, res, store) => {
    const key = await Attribution.getOrCreatePixelKey(store.id, req.user.id, { rotate: true });
    return { data: { key } };
  }),
  attribution: owned(async (req, res, store) => ({ data: Attribution.attribution(store.id, req.query, ownHost(store)) })),
  funnel: owned(async (req, res, store) => ({ data: Attribution.funnel(store.id, req.query, ownHost(store)) })),

  // ── Incrementality ──
  listExperiments: owned(async (req) => ({ data: Incrementality.listExperiments(req.params.storeId) })),
  createExperiment: owned(async (req) => ({ data: Incrementality.createExperiment(req.params.storeId, req.body) })),
  deleteExperiment: owned(async (req) => ({ data: { deleted: Incrementality.deleteExperiment(req.params.storeId, req.params.id) } })),
  analyzeExperiment: owned(async (req) => ({ data: Incrementality.analyze(req.params.storeId, req.params.id) })),
  suggestExperiment: owned(async (req) => ({
    data: Incrementality.suggestDesign(req.params.storeId, { duration_days: parseInt(req.query.duration_days, 10) || 21 }),
  })),

  // ── Activation ──
  audiences: owned(async (req) => ({
    data: { audiences: Activation.listAudiences(req.params.storeId), klaviyo_connected: Activation.klaviyoConnected(req.params.storeId), capi: Activation.capiConfig(req.params.storeId) },
  })),
  exportAudience: owned(async (req, res) => {
    const out = Activation.exportAudience(req.params.storeId, req.params.id, req.query.format === 'meta' ? 'meta' : 'csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.status(200).send(out.body);
  }),
  saveKlaviyo: owned(async (req) => ({ data: Activation.saveKlaviyo(req.params.storeId, req.body.api_key) })),
  klaviyoLists: owned(async (req) => ({ data: await Activation.klaviyoLists(req.params.storeId) })),
  pushKlaviyo: owned(async (req) => ({ data: await Activation.pushToKlaviyo(req.params.storeId, req.params.id, req.body.list_id) })),
  saveCapi: owned(async (req) => ({ data: Activation.saveCapi(req.params.storeId, req.body) })),
  sendCapi: owned(async (req) => ({ data: await Activation.sendPendingPurchases(req.params.storeId, { days: parseInt(req.body.days, 10) || 7 }) })),

  // ── Hub ──
  connectors: owned(async (req) => ({ data: Connectors.catalog(req.params.storeId) })),
  ask: owned(async (req, res, store) => {
    const q = String(req.body.question || '').trim();
    if (!q) throw new Error('Ask a question.');
    return { data: await Ask.ask(store.id, q.slice(0, 600), store.name) };
  }),
};

module.exports = MarketingController;

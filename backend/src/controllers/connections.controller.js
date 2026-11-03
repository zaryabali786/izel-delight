const StoreService = require('../services/store.service');
const Connections = require('../services/oauth/connections');
const Performance = require('../services/marketing/performance');

const { isOperator } = require('../utils/operator');

const owned = (fn) => async (req, res, next) => {
  try {
    const store = await StoreService.getStoreById(req.params.storeId, req.user.id);
    if (!store) return res.status(403).json({ success: false, error: 'Access denied: Store does not belong to your account.' });
    const out = await fn(req, res, store);
    if (out !== undefined && !res.headersSent) return res.status(200).json({ success: true, ...out });
  } catch (err) {
    if (err && err.message && !err.statusCode) return res.status(400).json({ success: false, error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
};

const ConnectionsController = {
  list: owned(async (req) => ({ data: Connections.catalog(req.params.storeId, { operator: isOperator(req.user) }) })),

  whatsappEmbeddedConfig: owned(async () => ({ data: Connections.embeddedConfig() })),

  whatsappEmbedded: owned(async (req, res, store) => ({
    data: await Connections.connectWhatsAppEmbedded(store.id, req.user.id, req.body || {}),
  })),

  start: owned(async (req, res, store) => ({
    data: await Connections.start(store.id, req.user.id, req.params.provider, { shop: req.body.shop }),
  })),

  saveCredentials: owned(async (req, res, store) => ({
    data: await Connections.saveCredentials(store.id, req.user.id, req.params.provider, req.body.fields),
  })),

  setAccounts: owned(async (req, res, store) => ({
    data: { accounts: await Connections.setSelectedAccounts(store.id, req.user.id, req.params.provider, req.body.selected) },
  })),

  disconnect: owned(async (req, res, store) => {
    await Connections.disconnect(store.id, req.user.id, req.params.provider);
    return { data: { disconnected: true } };
  }),

  sync: owned(async (req, res, store) => {
    if (req.params.provider !== 'meta-ads') throw new Error('Automatic sync is only available for Meta Ads right now. Import a CSV for other platforms.');
    return { data: await Performance.syncMetaAds(store.id, { days: parseInt(req.body.days, 10) || 30 }) };
  }),

  /**
   * Public: the provider redirects the user's browser here. Everything is validated through the
   * signed state; the response is a small page that reports back to the opener window.
   */
  async callback(req, res) {
    // The route key can be a vendor alias ("google"); the real provider id is read from the signed state.
    const routeKey = req.params.provider;
    let providerId = routeKey;
    try {
      const st = req.query.state ? Connections.verifyState(req.query.state) : null;
      if (st?.provider) providerId = st.provider;
    } catch (_) {
      /* handleCallback reports the invalid state below */
    }
    try {
      const r = await Connections.handleCallback(routeKey, req.query);
      return res.type('html').send(
        Connections.popupPage({ ok: true, provider: r.provider, message: r.accounts ? `${r.accounts} account(s) found.` : 'Connected. Choose your accounts next.' })
      );
    } catch (err) {
      console.warn(`[Connections] ${providerId} callback failed:`, err.message);
      return res.type('html').send(Connections.popupPage({ ok: false, provider: providerId, message: err.message }));
    }
  },
};

module.exports = ConnectionsController;

const StoreService = require('../services/store.service');
const Settings = require('../services/ai/settings');
const AutoReply = require('../services/auto-reply.service');

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

module.exports = {
  /** GET /api/ai-settings/:storeId */
  get: owned(async (req, res, store) => ({ settings: await Settings.getAiSettings(store.id) })),

  /** PUT /api/ai-settings/:storeId : partial update; validated server-side. */
  update: owned(async (req, res, store) => ({ settings: await Settings.updateAiSettings(store.id, req.body || {}) })),

  /**
   * POST /api/ai-settings/:storeId/test { message, channel }
   * Runs the real reply pipeline (settings, FAQs, catalog) on a made-up customer message so the owner can see
   * what the AI would say. Nothing is stored or sent.
   */
  test: owned(async (req, res, store) => {
    const message = String(req.body.message || '').trim().slice(0, 500);
    if (!message) throw new Error('Type a customer message to test.');
    const channelType = { whatsapp: 'whatsapp', comments: 'facebook_comment', dms: 'facebook_messenger', email: 'email' }[req.body.channel] || 'whatsapp';
    const conv = {
      id: 'test',
      channel_type: channelType,
      customer: { name: 'Test customer' },
      subject: channelType === 'email' ? 'Question' : null,
      metadata: {},
      messages: [{ sender_type: 'customer', message_text: message, created_at: new Date().toISOString() }],
    };
    const gen = await AutoReply.generateReply(store.id, conv);
    const settings = await Settings.getAiSettings(store.id);
    const keyword = Settings.needsHuman(message, settings.rules);
    return {
      reply: gen.handoff ? null : gen.text,
      handoff: gen.handoff || !!keyword,
      handoff_reason: keyword ? `Hand-off keyword "${keyword}": the AI would not answer automatically.` : gen.handoff ? 'The AI could not answer from your business information and FAQs.' : null,
      used_faqs: settings.faqs.filter((f) => gen.sources.faq_ids.includes(f.id)).map((f) => f.question),
      matched_products: gen.matchedProducts.map((p) => p.title),
    };
  }),
};

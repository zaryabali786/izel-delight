const crypto = require('crypto');
const StoreService = require('../store.service');

/**
 * Store-level AI settings: one place that controls AI for every channel.
 *
 * mode per channel group:
 *   off   - AI does nothing, messages just arrive in the inbox
 *   draft - AI writes a suggested reply and waits for a person to review, edit and send it
 *   auto  - AI sends the reply itself (still stops on hand-off keywords / when a person replies)
 *
 * The persona / instructions text is the store's existing `ai_prompt`, so there is a single source of truth
 * (the older AI-prompt editor and WhatsApp simulator keep working on the same value).
 */

const MODES = ['off', 'draft', 'auto'];
const GROUPS = ['whatsapp', 'comments', 'dms', 'email'];
const TONES = ['friendly', 'professional', 'casual', 'formal'];
const LANGUAGES = ['auto', 'english', 'urdu', 'roman-urdu'];
const LENGTHS = ['short', 'medium', 'detailed'];

const DEFAULTS = {
  channels: {
    whatsapp: { mode: 'off' },
    comments: { mode: 'off', private_reply: false },
    dms: { mode: 'off' },
    email: { mode: 'off' },
  },
  business: { about: '', hours: '', delivery: '', returns: '', payments: '', contact: '' },
  faqs: [],
  preferences: { tone: 'friendly', language: 'auto', length: 'short', signature: '', send_product_images: true },
  rules: {
    handoff_keywords: 'refund, complaint, scam, fraud, lawyer, legal, human, agent, manager',
    business_hours_only: false,
    business_hours: { start: '09:00', end: '21:00', tz: 'Asia/Karachi' },
    max_auto_replies_per_conversation: 3,
    pause_when_agent_replies: true,
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** Which settings group a conversation belongs to. */
function groupOf(channelType) {
  if (channelType === 'whatsapp') return 'whatsapp';
  if (channelType === 'email') return 'email';
  if (String(channelType).includes('comment')) return 'comments';
  return 'dms'; // facebook_messenger, instagram_dm
}

function merge(stored) {
  const s = stored || {};
  const out = clone(DEFAULTS);
  for (const g of GROUPS) out.channels[g] = { ...out.channels[g], ...(s.channels?.[g] || {}) };
  out.business = { ...out.business, ...(s.business || {}) };
  out.faqs = Array.isArray(s.faqs) ? s.faqs : [];
  out.preferences = { ...out.preferences, ...(s.preferences || {}) };
  out.rules = { ...out.rules, ...(s.rules || {}), business_hours: { ...out.rules.business_hours, ...(s.rules?.business_hours || {}) } };
  return out;
}

async function getAiSettings(storeId) {
  const store = await StoreService.getStoreByIdWithoutUser(storeId);
  if (!store) throw new Error('Store not found.');
  const settings = merge(store.settings?.ai);
  settings.instructions = await StoreService.getStoreAIPrompt(storeId);
  return settings;
}

/** Validate and normalise a patch from the UI. Unknown keys are dropped; nothing is trusted. */
function sanitize(patch, current) {
  const next = clone(current);
  delete next.instructions;

  if (patch.channels) {
    for (const g of GROUPS) {
      const p = patch.channels[g];
      if (!p) continue;
      next.channels[g].mode = pick(p.mode, MODES, next.channels[g].mode);
      if (g === 'comments' && typeof p.private_reply === 'boolean') next.channels.comments.private_reply = p.private_reply;
    }
  }
  if (patch.business) {
    for (const k of Object.keys(DEFAULTS.business)) if (patch.business[k] !== undefined) next.business[k] = str(patch.business[k], 1500);
  }
  if (Array.isArray(patch.faqs)) {
    if (patch.faqs.length > 100) throw new Error('You can save up to 100 FAQs.');
    next.faqs = patch.faqs
      .map((f) => ({ id: String(f.id || crypto.randomUUID()).slice(0, 64), question: str(f.question, 300), answer: str(f.answer, 2000) }))
      .filter((f) => f.question && f.answer);
  }
  if (patch.preferences) {
    const p = patch.preferences;
    next.preferences.tone = pick(p.tone, TONES, next.preferences.tone);
    next.preferences.language = pick(p.language, LANGUAGES, next.preferences.language);
    next.preferences.length = pick(p.length, LENGTHS, next.preferences.length);
    if (p.signature !== undefined) next.preferences.signature = str(p.signature, 300);
    if (typeof p.send_product_images === 'boolean') next.preferences.send_product_images = p.send_product_images;
  }
  if (patch.rules) {
    const r = patch.rules;
    if (r.handoff_keywords !== undefined) next.rules.handoff_keywords = str(r.handoff_keywords, 500);
    if (typeof r.business_hours_only === 'boolean') next.rules.business_hours_only = r.business_hours_only;
    if (typeof r.pause_when_agent_replies === 'boolean') next.rules.pause_when_agent_replies = r.pause_when_agent_replies;
    if (r.max_auto_replies_per_conversation !== undefined) {
      const n = parseInt(r.max_auto_replies_per_conversation, 10);
      if (!(n >= 1 && n <= 20)) throw new Error('Max automatic replies must be between 1 and 20.');
      next.rules.max_auto_replies_per_conversation = n;
    }
    if (r.business_hours) {
      const ok = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));
      if (r.business_hours.start !== undefined) {
        if (!ok(r.business_hours.start)) throw new Error('Opening time must look like 09:00.');
        next.rules.business_hours.start = r.business_hours.start;
      }
      if (r.business_hours.end !== undefined) {
        if (!ok(r.business_hours.end)) throw new Error('Closing time must look like 21:00.');
        next.rules.business_hours.end = r.business_hours.end;
      }
      if (r.business_hours.tz !== undefined) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: r.business_hours.tz });
        } catch (_) {
          throw new Error('Unknown time zone.');
        }
        next.rules.business_hours.tz = r.business_hours.tz;
      }
    }
  }
  return next;
}

async function updateAiSettings(storeId, patch) {
  const current = await getAiSettings(storeId);
  const next = sanitize(patch || {}, current);

  const db = StoreService.readLocalDb();
  const store = db.stores.find((s) => s.id === storeId);
  if (!store) throw new Error('Store not found.');
  store.settings = store.settings || {};
  store.settings.ai = next;
  store.updated_at = new Date().toISOString();
  StoreService.writeLocalDb(db);

  if (patch.instructions !== undefined) {
    const text = str(patch.instructions, 4000);
    if (!text) throw new Error('AI instructions cannot be empty.');
    await StoreService.updateStoreAIPrompt(storeId, text);
  }
  return getAiSettings(storeId);
}

// ── Knowledge ────────────────────────────────────────────────────────────────

const tokens = (s) =>
  String(s || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);

/** FAQs worth putting in the prompt for this customer message. Small sets are sent whole. */
function relevantFaqs(faqs, query, limit = 6) {
  if (faqs.length <= 8) return faqs;
  const q = new Set(tokens(query));
  if (q.size === 0) return faqs.slice(0, limit);
  const scored = faqs
    .map((f) => {
      const qt = tokens(f.question);
      const at = tokens(f.answer);
      let score = 0;
      for (const t of qt) if (q.has(t)) score += 3;
      for (const t of at) if (q.has(t)) score += 1;
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.f);
}

const BUSINESS_LABELS = { about: 'About the business', hours: 'Opening hours', delivery: 'Delivery', returns: 'Returns and exchanges', payments: 'Payment methods', contact: 'Contact details' };

function knowledgeBlock(settings, query) {
  const biz = Object.entries(BUSINESS_LABELS)
    .filter(([k]) => settings.business[k])
    .map(([k, label]) => `- ${label}: ${settings.business[k]}`)
    .join('\n');
  const faqs = relevantFaqs(settings.faqs, query);
  const faqText = faqs.map((f, i) => `Q${i + 1}: ${f.question}\nA${i + 1}: ${f.answer}`).join('\n\n');
  return {
    text: [biz && `BUSINESS INFORMATION (authoritative):\n${biz}`, faqText && `FAQ (authoritative answers, use them when relevant):\n${faqText}`].filter(Boolean).join('\n\n'),
    faqIds: faqs.map((f) => f.id),
  };
}

// ── Rules ────────────────────────────────────────────────────────────────────

function needsHuman(text, rules) {
  const words = String(rules.handoff_keywords || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const hay = String(text || '').toLowerCase();
  return words.find((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(hay)) || null;
}

function withinBusinessHours(rules, now = new Date()) {
  if (!rules.business_hours_only) return true;
  const { start, end, tz } = rules.business_hours;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const cur = `${parts.find((p) => p.type === 'hour').value}:${parts.find((p) => p.type === 'minute').value}`;
  return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end; // overnight windows
}

module.exports = {
  MODES,
  GROUPS,
  DEFAULTS,
  groupOf,
  getAiSettings,
  updateAiSettings,
  sanitize,
  merge,
  knowledgeBlock,
  relevantFaqs,
  needsHuman,
  withinBusinessHours,
};

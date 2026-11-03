const OpenAI = require('openai');
const StoreService = require('./store.service');
const AIService = require('./ai.service');
const Settings = require('./ai/settings');
const Posts = require('./social/posts');
const { emitToStore } = require('./realtime.service');

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// The language model call sits behind one function so tests (and, later, other providers) can replace it.
let llm = async ({ system, messages, maxTokens, temperature }) => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the server.');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [{ role: 'system', content: system }, ...messages],
    temperature,
    max_tokens: maxTokens,
  });
  return res.choices[0]?.message?.content?.trim() || '';
};

const HANDOFF = '[[HANDOFF]]';

// Background runs, so tests (and graceful shutdown) can wait for them.
const pending = new Set();

// Words that signal the customer is asking about a product / price / availability (to attach a product photo).
const PRODUCT_INTENT = /price|rate|kitn|how much|cost|available|stock|size|colou?r|order|buy|link|details|catalog|show|pic|photo|image|tasveer|chahiye|chahye|milega/i;

const TONE = {
  friendly: 'Warm and friendly, like a helpful shop assistant.',
  professional: 'Polite and professional.',
  casual: 'Relaxed and conversational.',
  formal: 'Formal and respectful.',
};
const LANGUAGE = {
  auto: "Reply in the customer's own language and script (English, Urdu or Roman Urdu).",
  english: 'Always reply in English.',
  urdu: 'Always reply in Urdu script.',
  'roman-urdu': 'Always reply in Roman Urdu (Urdu written with English letters).',
};
const LENGTH = { short: 'Keep it to 1-3 short sentences.', medium: 'Use 3-5 sentences.', detailed: 'Be thorough but under 150 words.' };

const CHANNEL = {
  comments: 'This is a PUBLIC comment under a post or ad. Keep it brief (max 220 characters). Never write phone numbers or addresses. For anything long (sizes, ordering, address), invite them to check their DM.',
  dms: 'This is a private chat. If the customer wants to order, ask for name, delivery address, city, phone number and size/variant.',
  whatsapp: 'This is a WhatsApp chat. Be concise and natural. If the customer wants to order, ask for name, delivery address, city, phone number and size/variant.',
  email: 'This is an email. Start with a greeting, answer clearly, end with a polite closing. Plain text only, no markdown.',
};

const CHANNEL_LABEL = { comments: 'Facebook/Instagram comment', dms: 'Facebook/Instagram direct message', whatsapp: 'WhatsApp', email: 'Email' };

function formatCatalog(store, products) {
  if (!products.length) return 'No specific matching products found.';
  return products
    .map((p) => {
      const url = p.product_url || (store.domain && p.handle ? `https://${store.domain}/products/${p.handle}` : null);
      return `- ${p.title} | Price: ${store.currency_symbol || 'PKR '}${Number(p.price).toLocaleString()} | ${p.stock > 0 ? `${p.stock} in stock` : 'Out of Stock'} | Category: ${p.category || 'General'}${p.description ? ` | ${String(p.description).slice(0, 160)}` : ''}${url ? ` | Link: ${url}` : ''}`;
    })
    .join('\n');
}

const AutoReplyService = {
  setLlm(fn) {
    llm = fn;
  },

  /**
   * Write a reply for any conversation using everything we know: the store's AI instructions, business
   * info and FAQs, the post the customer commented on, the catalog, their orders and the chat so far.
   */
  async generateReply(storeId, conv, { queryText } = {}) {
    const store = await StoreService.getStoreByIdWithoutUser(storeId);
    if (!store) throw new Error('Store not found.');
    const settings = await Settings.getAiSettings(storeId);
    const group = Settings.groupOf(conv.channel_type);

    const messages = (conv.messages || []).filter((m) => !m.is_private_note);
    const lastCustomer = [...messages].reverse().find((m) => m.sender_type === 'customer');
    const query = String(queryText || lastCustomer?.message_text || conv.subject || '').trim();
    if (!query) throw new Error('There is no customer message to reply to.');

    // Post context for comments: cached summary, else try to fetch it once.
    let post = conv.metadata?.post || null;
    if (group === 'comments' && !post && conv.channel_id && (conv.metadata?.post_id || conv.metadata?.parent_id)) {
      try {
        const channel = await StoreService.getSupportChannelById(storeId, conv.channel_id);
        if (channel?.credentials_encrypted) {
          post = Posts.summary(await Posts.ensurePost(storeId, channel, conv.metadata.post_id || conv.metadata.parent_id, { isInstagram: channel.channel_type === 'instagram', isAd: !!conv.metadata?.is_ad, adName: conv.metadata?.ad_name }));
        }
      } catch (_) {
        /* the AI still answers, with less context */
      }
    }

    const searchText = [query, post?.message?.slice(0, 200), conv.metadata?.ad_name].filter(Boolean).join(' ');
    const matchedProducts = await AIService.searchProducts(storeId, searchText, 3);

    const orders = conv.shopifyContext?.recent_orders || [];
    const ordersContext = orders.length
      ? orders.map((o) => `Order #${o.order_number || o.id}: ${o.order_status}, ${store.currency_symbol || 'PKR '}${o.total_amount}, tracking ${o.courier_name || 'n/a'} ${o.tracking_number || ''}`).join('\n')
      : 'No previous orders on record.';

    const knowledge = Settings.knowledgeBlock(settings, query);
    const prefs = settings.preferences;
    const postBlock = post
      ? `POST CONTEXT: the customer is commenting on this ${post.platform === 'instagram' ? 'Instagram' : 'Facebook'} ${post.is_ad ? 'ad' : 'post'}${post.ad_name ? ` ("${post.ad_name}")` : ''}:\n"${(post.message || '(no caption available)').slice(0, 700)}"`
      : '';

    const system = [
      settings.instructions,
      `STORE: ${store.name}. CHANNEL: ${CHANNEL_LABEL[group]}.`,
      `STYLE: ${TONE[prefs.tone]} ${LANGUAGE[prefs.language]} ${LENGTH[prefs.length]}`,
      knowledge.text,
      postBlock,
      `CUSTOMER: ${conv.customer?.name || 'Customer'}\nORDER HISTORY:\n${ordersContext}`,
      `CATALOG (only recommend items from this list):\n${formatCatalog(store, matchedProducts)}`,
      `RULES:\n1. Use only the information above (business info, FAQ, catalog, orders, post). Never invent prices, stock, policies or delivery times.\n2. If the answer is not in that information, or the customer is upset or asks for a person, reply with exactly ${HANDOFF} and nothing else.\n3. ${CHANNEL[group]}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const history = messages
      .slice(-12)
      .map((m) => ({ role: m.sender_type === 'customer' ? 'user' : 'assistant', content: m.message_text || '' }));
    // The latest customer message is the final turn.
    if (history.length && history[history.length - 1].role === 'user') history.pop();

    let text = await llm({ system, messages: [...history, { role: 'user', content: query }], maxTokens: group === 'comments' ? 140 : group === 'email' ? 450 : 320, temperature: 0.3 });
    const handoff = text.includes(HANDOFF) || !text;
    if (!handoff && group === 'email' && prefs.signature) text = `${text}\n\n${prefs.signature}`;

    const images =
      !handoff && prefs.send_product_images && group !== 'email' && (PRODUCT_INTENT.test(query) || matchedProducts.length === 1)
        ? matchedProducts
            .filter((p) => p.image_url && /^https?:\/\//.test(p.image_url))
            .slice(0, 1)
            .map((p) => ({ url: p.image_url, caption: `${p.title} - ${store.currency_symbol || 'PKR '}${Number(p.price).toLocaleString()}` }))
        : [];

    return { text: handoff ? '' : text, handoff, matchedProducts, images, sources: { faq_ids: knowledge.faqIds, post: !!post } };
  },

  async saveDraft(storeId, conv, gen) {
    const draft = { text: gen.text, images: gen.images, sources: gen.sources, created_at: new Date().toISOString() };
    await StoreService.updateConversation(storeId, conv.id, { metadata: { ...(conv.metadata || {}), ai_draft: draft } });
    emitToStore(storeId, 'inbox:draft', { storeId, conversationId: conv.id, draft });
    return draft;
  },

  async clearDraft(storeId, conversationId) {
    const conv = await StoreService.getConversationWithDetails(storeId, conversationId);
    if (conv?.metadata?.ai_draft) {
      const { ai_draft, ...rest } = conv.metadata;
      await StoreService.updateConversation(storeId, conversationId, { metadata: rest });
      emitToStore(storeId, 'inbox:draft', { storeId, conversationId, draft: null });
    }
  },

  async flagHandoff(storeId, conv, reason) {
    await StoreService.updateConversation(storeId, conv.id, {
      status: 'pending',
      priority: 'high',
      metadata: { ...(conv.metadata || {}), needs_human: { reason, at: new Date().toISOString() } },
    });
    emitToStore(storeId, 'inbox:handoff', { storeId, conversationId: conv.id, reason });
  },

  /**
   * Called when a customer message has been stored. Applies the store's AI settings for that channel:
   * off -> nothing, draft -> prepare a suggestion for a person, auto -> send it.
   * Returns what happened so callers (and tests) can see it; it never throws.
   */
  maybeAutoReply(storeId, conversationId) {
    const p = this._run(storeId, conversationId);
    pending.add(p);
    p.finally(() => pending.delete(p));
    return p;
  },

  /** Resolves when every automatic reply started so far has finished. */
  async whenIdle() {
    while (pending.size) await Promise.allSettled([...pending]);
  },

  async _run(storeId, conversationId) {
    try {
      const settings = await Settings.getAiSettings(storeId);
      const conv = await StoreService.getConversationWithDetails(storeId, conversationId);
      if (!conv) return { action: 'skipped', reason: 'conversation not found' };

      const group = Settings.groupOf(conv.channel_type);
      const mode = settings.channels[group].mode;
      if (mode === 'off') return { action: 'skipped', reason: 'off' };
      if (conv.metadata?.ai_paused) return { action: 'skipped', reason: 'paused for this conversation' };

      const msgs = (conv.messages || []).filter((m) => !m.is_private_note);
      const last = msgs[msgs.length - 1];
      if (!last || last.sender_type !== 'customer') return { action: 'skipped', reason: 'last message is not from the customer' };

      if (settings.rules.pause_when_agent_replies && msgs.some((m) => m.sender_type === 'agent')) return { action: 'skipped', reason: 'a person is handling this conversation' };

      const hit = Settings.needsHuman(last.message_text, settings.rules);
      if (hit) {
        await this.flagHandoff(storeId, conv, `Customer mentioned "${hit}"`);
        return { action: 'handoff', reason: `keyword "${hit}"` };
      }
      if (!Settings.withinBusinessHours(settings.rules)) return { action: 'skipped', reason: 'outside business hours' };
      if (mode === 'auto' && msgs.filter((m) => m.sender_type === 'ai').length >= settings.rules.max_auto_replies_per_conversation) {
        await this.flagHandoff(storeId, conv, 'Automatic reply limit reached');
        return { action: 'handoff', reason: 'automatic reply limit reached' };
      }

      const gen = await this.generateReply(storeId, conv);
      if (gen.handoff) {
        await this.flagHandoff(storeId, conv, 'The AI could not answer from your business information');
        return { action: 'handoff', reason: 'no answer in knowledge base' };
      }

      if (mode === 'draft') {
        await this.saveDraft(storeId, conv, gen);
        return { action: 'drafted', text: gen.text };
      }

      const { sendReply } = require('./messaging/sender');
      await sendReply(storeId, conv, { text: gen.text, images: gen.images, senderType: 'ai', senderName: 'Store AI' });
      if (group === 'comments' && settings.channels.comments.private_reply) {
        try {
          const Channels = require('./support-channels.service');
          await Channels.sendPrivateReplyFromComment(storeId, conv.id, gen.text, { senderType: 'ai', senderName: 'Store AI' });
        } catch (e) {
          console.warn('[AutoReply] private reply failed:', e.message);
        }
      }
      return { action: 'sent', text: gen.text };
    } catch (err) {
      console.error('[AutoReply] failed:', err.message);
      return { action: 'error', reason: err.message };
    }
  },
};

module.exports = AutoReplyService;

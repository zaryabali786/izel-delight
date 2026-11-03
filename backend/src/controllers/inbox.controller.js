const StoreService = require('../services/store.service');
const SupportChannelsService = require('../services/support-channels.service');
const AutoReplyService = require('../services/auto-reply.service');
const Posts = require('../services/social/posts');
const { syncChannelMessages } = require('../services/social/messages-sync');
const { sendReply } = require('../services/messaging/sender');

/**
 * Wrapper: the signed-in user must own :storeId (multi-tenant isolation), the conversation (when :id is
 * present) must belong to that store, and errors become readable 4xx responses instead of fake successes.
 */
const owned = (fn, { conversation = false } = {}) => async (req, res, next) => {
  try {
    const store = await StoreService.getStoreById(req.params.storeId, req.user.id);
    if (!store) return res.status(403).json({ success: false, error: 'Access denied: Store does not belong to your account.' });
    let conv = null;
    if (conversation) {
      conv = await StoreService.getConversationWithDetails(store.id, req.params.id);
      if (!conv) return res.status(404).json({ success: false, error: 'Conversation not found.' });
    }
    const out = await fn(req, res, store, conv);
    if (out !== undefined && !res.headersSent) return res.status(200).json({ success: true, ...out });
  } catch (err) {
    if (err && err.message && !err.statusCode) return res.status(400).json({ success: false, error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
};

const InboxController = {
  /** GET /api/inbox/:storeId/conversations?channel_type=&state=&status=&search= */
  getConversations: owned(async (req, res, store) => {
    const { channel_type, status, state, search, kind } = req.query;
    const { conversations, counts } = await StoreService.getStoreConversations(store.id, {
      channel_type: channel_type || 'all',
      status: status || 'all',
      state: state || 'all',
      kind: kind || 'all',
      search: search || '',
    });
    return { conversations, counts };
  }),

  /** GET /api/inbox/:storeId/conversations/:id : opening a conversation marks it read. */
  getConversation: owned(
    async (req, res, store, conv) => {
      if ((conv.unread_count || 0) > 0) {
        await StoreService.updateConversation(store.id, conv.id, { unread_count: 0 });
        conv.unread_count = 0;
      }
      return { conversation: conv };
    },
    { conversation: true }
  ),

  /** POST /api/inbox/:storeId/conversations/:id/messages : sends on the real channel, or saves an internal note. */
  sendMessage: owned(
    async (req, res, store, conv) => {
      const { text, is_private_note } = req.body;
      const body = String(text || '').trim();
      if (!body) throw new Error('Message text is required.');

      if (is_private_note) {
        const note = await StoreService.addConversationMessage(store.id, conv.id, {
          sender_type: 'agent',
          sender_name: req.user.email || 'Team note',
          message_text: body,
          is_private_note: true,
        });
        return { message: note };
      }

      const message = await sendReply(store.id, conv, { text: body, images: [], senderType: 'agent', senderName: req.user.email || 'Agent' });
      await AutoReplyService.clearDraft(store.id, conv.id); // a person answered; the AI suggestion is stale
      return { message };
    },
    { conversation: true }
  ),

  /** POST .../comment-action : like | delete | private_dm */
  performCommentAction: owned(
    async (req, res, store, conv) => {
      const { action, messageText } = req.body;
      if (!String(conv.channel_type).includes('comment')) throw new Error('This conversation is not a comment.');
      let result;
      if (action === 'like') result = await SupportChannelsService.likeComment(store.id, conv.id);
      else if (action === 'delete') result = await SupportChannelsService.deleteComment(store.id, conv.id);
      else if (action === 'private_dm') {
        if (!messageText) throw new Error('messageText is required for a private DM.');
        result = await SupportChannelsService.sendPrivateReplyFromComment(store.id, conv.id, messageText);
      } else throw new Error('Invalid action. Supported: like, delete, private_dm');
      return { result };
    },
    { conversation: true }
  ),

  /** POST .../ai-reply : generate a suggestion on demand and keep it as the conversation's draft. */
  generateAiReply: owned(
    async (req, res, store, conv) => {
      const gen = await AutoReplyService.generateReply(store.id, conv);
      if (gen.handoff) return { draftText: '', handoff: true, matchedProducts: gen.matchedProducts, images: [], sources: gen.sources };
      await AutoReplyService.saveDraft(store.id, conv, gen);
      return { draftText: gen.text, handoff: false, matchedProducts: gen.matchedProducts, images: gen.images, sources: gen.sources };
    },
    { conversation: true }
  ),

  /** DELETE .../draft : dismiss the AI suggestion. */
  dismissDraft: owned(
    async (req, res, store, conv) => {
      await AutoReplyService.clearDraft(store.id, conv.id);
      return { dismissed: true };
    },
    { conversation: true }
  ),

  /** PUT .../ai-pause : stop (or resume) AI on one conversation. */
  setAiPaused: owned(
    async (req, res, store, conv) => {
      const meta = { ...(conv.metadata || {}), ai_paused: !!req.body.paused };
      if (req.body.paused === false) delete meta.needs_human;
      const updated = await StoreService.updateConversation(store.id, conv.id, { metadata: meta });
      return { conversation: updated };
    },
    { conversation: true }
  ),

  /** PUT .../status */
  updateStatus: owned(
    async (req, res, store, conv) => {
      const { status, priority, assigned_agent } = req.body;
      const updated = await StoreService.updateConversation(store.id, conv.id, {
        ...(status && { status }),
        ...(priority && { priority }),
        ...(assigned_agent !== undefined && { assigned_agent }),
      });
      return { conversation: updated };
    },
    { conversation: true }
  ),

  /** GET /api/inbox/:storeId/posts : posts that have comments, with counts. */
  getPosts: owned(async (req, res, store) => ({ posts: Posts.listPosts(store.id, { channelType: req.query.channel_type }) })),

  /** POST /api/inbox/:storeId/sync : import recent Facebook / Instagram posts and their comments. */
  syncSocial: owned(async (req, res, store) => {
    const channels = StoreService.readLocalDb().support_channels.filter(
      (c) => c.store_id === store.id && ['facebook', 'instagram'].includes(c.channel_type) && c.status === 'connected'
    );
    if (channels.length === 0) throw new Error('Connect a Facebook Page or Instagram account first.');
    const results = [];
    for (const ch of channels) {
      const limit = parseInt(req.body.limit, 10) || 15;
      const row = { channel: ch.name, channel_type: ch.channel_type };
      const errors = [];
      try {
        Object.assign(row, await Posts.syncChannelPosts(store.id, ch.id, { limit }));
      } catch (e) {
        errors.push(e.message);
      }
      try {
        Object.assign(row, await syncChannelMessages(store.id, ch.id, { limit }));
      } catch (e) {
        errors.push(e.message);
      }
      if (errors.length) row.error = errors.join(' ');
      results.push(row);
    }
    return { results };
  }),
};

module.exports = InboxController;

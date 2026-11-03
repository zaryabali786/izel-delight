const axios = require('axios');
const StoreService = require('../store.service');
const { decrypt } = require('../../utils/crypto');

const G = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v20.0'}`;
const errMsg = (e) => e.response?.data?.error?.message || e.message;

const iso = (v) => {
  const d = new Date(v);
  return v && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
};

/**
 * Import recent Messenger / Instagram direct-message history with the official Conversations API
 * (GET /{page-id}/conversations?platform=messenger|instagram). Imported history is stored as read and is never
 * auto-replied; live messages keep arriving through the webhook.
 */
async function syncChannelMessages(storeId, channelId, { limit = 15 } = {}) {
  const channel = await StoreService.getSupportChannelById(storeId, channelId);
  if (!channel || channel.status !== 'connected' || !channel.credentials_encrypted) throw new Error('This channel is not connected.');
  if (!['facebook', 'instagram'].includes(channel.channel_type)) throw new Error('Message sync is only available for Facebook and Instagram.');
  const isInstagram = channel.channel_type === 'instagram';
  const token = decrypt(channel.credentials_encrypted);
  const pageId = channel.settings?.parent_page_id || channel.account_id; // Instagram history is read through the linked Page
  const businessId = String(channel.account_id);

  let threads;
  try {
    const r = await axios.get(`${G()}/${pageId}/conversations`, {
      params: {
        platform: isInstagram ? 'instagram' : 'messenger',
        fields: 'id,updated_time,participants,messages.limit(25){id,message,from,created_time,attachments}',
        limit: Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50),
        access_token: token,
      },
      timeout: 30000,
    });
    threads = r.data?.data || [];
  } catch (e) {
    throw new Error(`Could not read ${isInstagram ? 'Instagram' : 'Messenger'} messages: ${errMsg(e)}`);
  }

  let conversations = 0;
  let imported = 0;
  for (const t of threads) {
    const other = (t.participants?.data || []).find((p) => String(p.id) !== businessId && String(p.id) !== String(pageId));
    if (!other) continue;
    const msgs = [...(t.messages?.data || [])].reverse(); // API returns newest first
    if (msgs.length === 0) continue;

    const customer = await StoreService.findOrCreateCustomer(storeId, {
      name: other.name || other.username || (isInstagram ? `Instagram User (${String(other.id).slice(-4)})` : `Facebook User (${String(other.id).slice(-4)})`),
      ...(isInstagram ? { instagram_id: other.id } : { facebook_psid: other.id }),
    });
    const before = StoreService.readLocalDb().conversations.find((c) => c.store_id === storeId && c.external_thread_id === String(other.id) && c.channel_id === channel.id);
    const last = msgs[msgs.length - 1];
    const conv = await StoreService.findOrCreateConversation(storeId, {
      channel_id: channel.id,
      channel_type: isInstagram ? 'instagram_dm' : 'facebook_messenger',
      customer_id: customer.id,
      external_thread_id: other.id,
      last_message_preview: before ? '' : last.message || 'Sent an attachment',
      unread_count: 0,
      created_at: iso(msgs[0].created_time),
      metadata: { platform_user_id: other.id, recipient_account_id: businessId, imported: true },
    });
    if (!before) conversations++;

    const known = new Set(StoreService.readLocalDb().conversation_messages.filter((m) => m.conversation_id === conv.id).map((m) => m.external_message_id));
    for (const m of msgs) {
      if (known.has(String(m.id))) continue;
      const own = String(m.from?.id) === businessId || String(m.from?.id) === String(pageId);
      const atts = (m.attachments?.data || []).map((a) => ({ type: a.mime_type?.startsWith('video') ? 'video' : 'image', url: a.image_data?.url || a.video_data?.url || a.file_url }));
      await StoreService.addConversationMessage(storeId, conv.id, {
        external_message_id: m.id,
        sender_type: own ? 'agent' : 'customer',
        sender_name: own ? channel.name : customer.name,
        sender_id: m.from?.id,
        message_text: m.message || (atts.length ? 'Sent an attachment' : ''),
        message_type: atts.length ? atts[0].type : 'text',
        attachments: atts.filter((a) => a.url),
        status: 'delivered',
        created_at: iso(m.created_time),
        silent: true,
      });
      imported++;
    }
  }
  return { conversations, messages_imported: imported };
}

module.exports = { syncChannelMessages };

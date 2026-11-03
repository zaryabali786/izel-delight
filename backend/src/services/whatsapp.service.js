const axios = require('axios');
const StoreService = require('./store.service');
const AIService = require('./ai.service');
const { decrypt } = require('../utils/crypto');

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v20.0'}`;

const WhatsAppService = {
  /** Cloud API credentials of the store's WhatsApp connection (token decrypted), or null. */
  async credsForStore(storeId) {
    const integ = StoreService.readLocalDb().integrations.find((i) => i.store_id === storeId && i.provider === 'whatsapp-business' && i.status === 'connected');
    const enc = integ?.config?.permanentToken_encrypted;
    if (!integ?.config?.phoneNumberId || !enc) return null;
    return { storeId, phoneNumberId: integ.config.phoneNumberId, token: decrypt(enc) };
  },

  /** Find the store + decrypted Cloud API credentials that own a WhatsApp phone_number_id. */
  async resolveStoreByPhoneNumberId(phoneNumberId) {
    const db = StoreService.readLocalDb();
    const integ = db.integrations.find((i) => i.provider === 'whatsapp-business' && i.status === 'connected' && String(i.config?.phoneNumberId) === String(phoneNumberId));
    if (!integ) return null;
    const enc = integ.config?.permanentToken_encrypted;
    if (!enc) return null;
    return { storeId: integ.store_id, phoneNumberId, token: decrypt(enc) };
  },

  async sendText(creds, to, body) {
    return axios.post(
      `${GRAPH}/${creds.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: true } },
      { headers: { Authorization: `Bearer ${creds.token}` }, timeout: 10000 }
    );
  },

  async sendImage(creds, to, link, caption) {
    return axios.post(
      `${GRAPH}/${creds.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'image', image: { link, caption: (caption || '').slice(0, 1000) } },
      { headers: { Authorization: `Bearer ${creds.token}` }, timeout: 15000 }
    );
  },

  async downloadMedia(creds, mediaId) {
    const meta = await axios.get(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${creds.token}` }, timeout: 10000 });
    const file = await axios.get(meta.data.url, { headers: { Authorization: `Bearer ${creds.token}` }, responseType: 'arraybuffer', timeout: 20000 });
    return { buffer: Buffer.from(file.data), mimetype: meta.data.mime_type || 'audio/ogg' };
  },

  /**
   * One inbound WhatsApp Cloud API message: stored in the unified inbox like every other channel,
   * then handed to the AI settings (off / draft for review / automatic).
   */
  async handleIncoming({ phoneNumberId, message, contact }) {
    const creds = await this.resolveStoreByPhoneNumberId(phoneNumberId);
    if (!creds) {
      console.warn(`[WhatsApp] No store connected for phone_number_id ${phoneNumberId}`);
      return;
    }
    const storeId = creds.storeId;
    const from = String(message.from);
    const customerName = contact?.profile?.name || `WhatsApp ${from.slice(-4)}`;

    let text = '';
    let type = 'text';
    let attachments = [];
    if (message.type === 'text') {
      text = message.text?.body || '';
    } else if (message.type === 'audio') {
      type = 'audio';
      try {
        const media = await this.downloadMedia(creds, message.audio.id);
        text = await AIService.transcribeAudio(media.buffer, media.mimetype);
      } catch (e) {
        console.warn('[WhatsApp] Voice note transcription failed:', e.message);
        text = '(Voice message, could not be transcribed)';
      }
    } else if (message.type === 'image') {
      type = 'image';
      text = message.image?.caption || '(Photo)';
      attachments = [{ type: 'image', media_id: message.image?.id }];
    } else if (message.type === 'interactive') {
      text = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
    } else if (message.type === 'button') {
      text = message.button?.text || '';
    } else {
      return; // reactions, stickers, locations: not handled yet
    }
    if (!text) return;

    // Redelivery guard: Meta retries until it gets a 200.
    const existing = StoreService.readLocalDb().conversation_messages.find((m) => m.store_id === storeId && m.external_message_id === message.id);
    if (existing) return;

    const customer = await StoreService.findOrCreateCustomer(storeId, { name: customerName, phone: `+${from}`, whatsapp_phone: from });
    const conv = await StoreService.findOrCreateConversation(storeId, {
      channel_type: 'whatsapp',
      customer_id: customer.id,
      external_thread_id: from,
      last_message_preview: text,
      is_incoming: true,
      metadata: { phone_number_id: phoneNumberId },
    });
    await StoreService.addConversationMessage(storeId, conv.id, {
      external_message_id: message.id,
      sender_type: 'customer',
      sender_name: customerName,
      sender_id: from,
      message_text: text,
      message_type: type,
      attachments,
      status: 'delivered',
      // WhatsApp timestamps have 1-second resolution; mixing them with our millisecond clock can put our own reply
      // before a customer message sent in the same second. Use the receive time, and the platform time only for a backlog.
      created_at: message.timestamp && Date.now() - Number(message.timestamp) * 1000 > 2 * 60 * 1000 ? new Date(Number(message.timestamp) * 1000).toISOString() : undefined,
    });

    require('./auto-reply.service').maybeAutoReply(storeId, conv.id);
  },

  /** Delivery receipts (sent / delivered / read / failed) update the message we stored when we sent it. */
  applyStatus(status) {
    const db = StoreService.readLocalDb();
    const m = db.conversation_messages.find((x) => x.external_message_id === status.id);
    if (!m) return false;
    const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
    if (!map[status.status]) return false;
    m.status = map[status.status];
    if (status.status === 'failed') m.metadata = { ...(m.metadata || {}), error: status.errors?.[0]?.title || 'Delivery failed' };
    StoreService.writeLocalDb(db);
    const { emitToStore } = require('./realtime.service');
    emitToStore(m.store_id, 'inbox:message_status', { conversationId: m.conversation_id, messageId: m.id, status: m.status });
    return true;
  },
};

module.exports = WhatsAppService;

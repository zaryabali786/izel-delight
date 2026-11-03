const StoreService = require('../store.service');
const { groupOf } = require('../ai/settings');

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * One entry point for "send this reply on whatever channel the conversation lives on".
 * Every branch performs a real API call and throws the provider's real error: there is no path that
 * records a message as sent without sending it.
 */
async function sendReply(storeId, conv, { text, images = [], senderType = 'agent', senderName } = {}) {
  const body = String(text || '').trim();
  if (!body) throw new Error('Message text is required.');
  const Channels = require('../support-channels.service');
  const group = groupOf(conv.channel_type);

  if (group === 'whatsapp') {
    const WhatsApp = require('../whatsapp.service');
    const creds = await WhatsApp.credsForStore(storeId);
    if (!creds) throw new Error('WhatsApp is not connected for this store.');

    // WhatsApp only allows free-form messages within 24 hours of the customer's last message.
    const last = [...(conv.messages || [])].reverse().find((m) => m.sender_type === 'customer');
    const lastAt = last ? new Date(last.created_at).getTime() : 0;
    if (!lastAt || Date.now() - lastAt > WINDOW_MS) {
      const err = new Error("WhatsApp only allows free-form replies within 24 hours of the customer's last message. Wait for them to write again, or send an approved template.");
      err.code = 'whatsapp_window_closed';
      throw err;
    }
    const to = conv.external_thread_id || String(conv.customer?.whatsapp_phone || '').replace(/[^0-9]/g, '');
    if (!to) throw new Error('This conversation has no WhatsApp number.');

    let res;
    try {
      res = await WhatsApp.sendText(creds, to, body);
    } catch (e) {
      throw new Error(`WhatsApp could not deliver the message: ${e.response?.data?.error?.message || e.message}`);
    }
    const sentImages = [];
    for (const img of images) {
      try {
        await WhatsApp.sendImage(creds, to, img.url, img.caption);
        sentImages.push({ type: 'image', url: img.url, caption: img.caption });
      } catch (e) {
        console.warn('[Sender] WhatsApp image failed:', e.response?.data?.error?.message || e.message);
      }
    }
    return StoreService.addConversationMessage(storeId, conv.id, {
      external_message_id: res.data?.messages?.[0]?.id,
      sender_type: senderType,
      sender_name: senderName || (senderType === 'ai' ? 'Store AI' : 'Agent'),
      message_text: body,
      message_type: 'text',
      attachments: sentImages,
      status: 'sent',
    });
  }

  const opts = { senderType, senderName: senderName || (senderType === 'ai' ? 'Store AI' : undefined), images };
  if (group === 'email') return Channels.sendEmailReply(storeId, conv.id, body, senderName || 'Support Team', { senderType });
  if (group === 'comments') return Channels.replyToComment(storeId, conv.id, body, opts);
  return Channels.sendDirectMessage(storeId, conv.id, body, opts);
}

module.exports = { sendReply, WINDOW_MS };

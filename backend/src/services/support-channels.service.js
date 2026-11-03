const axios = require('axios');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { encrypt, decrypt, verifyHmacSha256, verifyMetaSignature } = require('../utils/crypto');
const StoreService = require('./store.service');
const { emitToStore } = require('./realtime.service');

const BACKEND_URL = require('../utils/urls').backendUrl();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8100';

const META_APP_ID = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'db_tech_meta_verify_2026';

// Email Transporter for Outbound Customer Support
let mailTransporter = null;
function getMailTransporter() {
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtpout.secureserver.net',
      port: parseInt(process.env.SMTP_PORT || '465', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
      tls: { rejectUnauthorized: false },
    });
  }
  return mailTransporter;
}

const SupportChannelsService = {
  // ── 1. META (FACEBOOK + INSTAGRAM) OFFICIAL OAUTH FLOW ─────────────────────

  /**
   * Generate official Meta OAuth Dialog URL
   */
  getMetaOAuthUrl(storeId, userId, { popup = false } = {}) {
    if (!META_APP_ID) {
      console.warn('[SupportChannels] META_APP_ID is not configured in environment.');
    }

    const redirectUri = `${BACKEND_URL}/api/support-channels/meta/callback`;
    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'pages_manage_messages',
      'pages_read_user_content',
      'instagram_basic',
      'instagram_manage_messages',
      'instagram_manage_comments',
      'ads_read',
      'business_management',
    ].join(',');

    const statePayload = JSON.stringify({ storeId, userId, popup, timestamp: Date.now() });
    const stateSig = crypto.createHmac('sha256', META_APP_SECRET || 'meta-secret').update(statePayload).digest('hex');
    const state = Buffer.from(JSON.stringify({ payload: statePayload, sig: stateSig })).toString('base64');

    return `https://www.facebook.com/v20.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}&response_type=code`;
  },

  /**
   * Handle Meta OAuth redirect callback, exchange code, fetch Pages & IG accounts
   */
  async handleMetaOAuthCallback(code, state) {
    let stateData;
    try {
      const raw = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      const expectedSig = crypto.createHmac('sha256', META_APP_SECRET || 'meta-secret').update(raw.payload).digest('hex');
      if (expectedSig !== raw.sig) {
        throw new Error('Meta OAuth state signature mismatch.');
      }
      stateData = JSON.parse(raw.payload);
    } catch (_) {
      throw new Error('Invalid Meta OAuth state parameter.');
    }

    if (!stateData.timestamp || Date.now() - stateData.timestamp > 15 * 60 * 1000) {
      throw new Error('The connection attempt expired. Please try again.');
    }
    const { storeId, userId } = stateData;
    const redirectUri = `${BACKEND_URL}/api/support-channels/meta/callback`;

    // 1. Exchange authorization code for short-lived user access token
    const tokenRes = await axios.get('https://graph.facebook.com/v20.0/oauth/access_token', {
      params: {
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      },
      timeout: 15000,
    });

    const shortLivedToken = tokenRes.data.access_token;
    if (!shortLivedToken) throw new Error('Failed to retrieve user token from Meta.');

    // 2. Exchange for long-lived user token (60-day validity)
    let longLivedToken = shortLivedToken;
    try {
      const longRes = await axios.get('https://graph.facebook.com/v20.0/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: META_APP_ID,
          client_secret: META_APP_SECRET,
          fb_exchange_token: shortLivedToken,
        },
        timeout: 15000,
      });
      if (longRes.data?.access_token) {
        longLivedToken = longRes.data.access_token;
      }
    } catch (e) {
      console.warn('[SupportChannels] Long-lived token exchange notice:', e.message);
    }

    // 3. Fetch user's Facebook Pages and connected Instagram Business accounts
    const pagesRes = await axios.get('https://graph.facebook.com/v20.0/me/accounts', {
      params: {
        fields: 'id,name,access_token,category,instagram_business_account{id,username,name,profile_picture_url}',
        access_token: longLivedToken,
      },
      timeout: 15000,
    });

    const pages = pagesRes.data?.data || [];
    const connectedChannels = [];

    // 4. Automatically connect and subscribe webhooks for discovered pages & IG accounts
    for (const page of pages) {
      const pageToken = page.access_token;
      const pageId = page.id;
      const pageName = page.name;

      // Subscribe DB app to Page Webhooks (messages, feed, mentions)
      try {
        await axios.post(
          `https://graph.facebook.com/v20.0/${pageId}/subscribed_apps`,
          null,
          {
            params: {
              subscribed_fields: 'messages,messaging_postbacks,message_deliveries,message_reads,feed,mention',
              access_token: pageToken,
            },
            timeout: 10000,
          }
        );
      } catch (subErr) {
        console.warn(`[SupportChannels] Subscribed apps notice for ${pageName}:`, subErr.message);
      }

      // Save Facebook Channel
      const fbChannel = await StoreService.upsertSupportChannel(storeId, userId, {
        channel_type: 'facebook',
        name: `Facebook: ${pageName}`,
        account_id: pageId,
        status: 'connected',
        credentials_encrypted: encrypt(pageToken),
        webhook_verified: true,
        settings: {
          page_id: pageId,
          page_name: pageName,
          category: page.category,
          supports_ad_comments: true,
          supports_private_replies: true,
        },
      });
      connectedChannels.push(fbChannel);

      // Check if this Page has an Instagram Business account connected
      if (page.instagram_business_account?.id) {
        const ig = page.instagram_business_account;
        const igChannel = await StoreService.upsertSupportChannel(storeId, userId, {
          channel_type: 'instagram',
          name: `Instagram: @${ig.username || ig.name || 'Account'}`,
          account_id: ig.id,
          status: 'connected',
          credentials_encrypted: encrypt(pageToken), // Page token has permission to manage connected IG account
          webhook_verified: true,
          settings: {
            instagram_business_id: ig.id,
            username: ig.username,
            name: ig.name,
            profile_picture_url: ig.profile_picture_url,
            parent_page_id: pageId,
            supports_ad_comments: true,
            supports_reels: true,
          },
        });
        connectedChannels.push(igChannel);
      }
    }

    emitToStore(storeId, 'channels:updated', { storeId, count: connectedChannels.length });

    return { storeId, pagesCount: pages.length, connectedChannels, popup: !!stateData.popup };
  },

  // ── 2. EMAIL SUPPORT CHANNEL (INBOUND FORWARDING + SMTP OUTBOUND) ──────────

  /**
   * Set up an Email Support Channel with a unique forwarding routing address
   */
  async connectEmailChannel(storeId, userId, businessEmail, displayName) {
    const cleanEmail = (businessEmail || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Valid business email address is required.');
    }

    const domain = cleanEmail.split('@')[1];
    // Generate unique inbound forwarding address for DelightChat-style forwarding
    const forwardingSlug = crypto.randomBytes(4).toString('hex');
    const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN || 'inbound.thesellsphere.com';
    const inboundForwardingAddress = `support+${storeId.slice(0, 8)}_${forwardingSlug}@${inboundDomain}`;

    const channel = await StoreService.upsertSupportChannel(storeId, userId, {
      channel_type: 'email',
      name: displayName || `Support (${cleanEmail})`,
      account_id: cleanEmail,
      status: 'connected',
      credentials_encrypted: null, // No mailbox password stored!
      webhook_verified: true,
      settings: {
        business_email: cleanEmail,
        inbound_address: inboundForwardingAddress,
        domain: domain,
        dns_instructions: {
          forwarding_address: inboundForwardingAddress,
          spf_record: process.env.INBOUND_EMAIL_SPF || null,
          mx_priority: 10,
        },
        auto_responder_enabled: true,
      },
    });

    emitToStore(storeId, 'channels:updated', { storeId });
    return channel;
  },

  /**
   * Ingest incoming email webhook from inbound email forwarder/gateway
   */
  async handleInboundEmail(payload) {
    const fromAddress = payload.from || payload.sender || '';
    const toAddress = payload.to || payload.recipient || '';
    const subject = payload.subject || 'Support Request';
    const textBody = payload.text || payload['body-plain'] || payload.stripped_text || '';
    const htmlBody = payload.html || payload['body-html'] || '';
    const messageId = payload['message-id'] || payload.messageId || `msg_${Date.now()}`;
    const inReplyTo = payload['in-reply-to'] || payload.inReplyTo || null;
    const references = payload.references || null;

    console.log(`📧 [SupportChannels] Inbound email from: ${fromAddress} to: ${toAddress} subject: ${subject}`);

    // Parse sender name & email: "Ali Khan <ali@example.com>"
    let senderName = 'Customer';
    let senderEmail = fromAddress;
    const match = fromAddress.match(/(.*?)\s*<(.+?)>/);
    if (match) {
      senderName = match[1].replace(/['"]/g, '').trim() || 'Customer';
      senderEmail = match[2].trim().toLowerCase();
    } else {
      senderEmail = fromAddress.replace(/[<>]/g, '').trim().toLowerCase();
    }

    // Resolve store: match by inbound address or direct channel account_id
    const matchedChannel = await StoreService.findSupportChannelByInboundEmail(toAddress);

    if (!matchedChannel) {
      console.warn(`[SupportChannels] No store email channel matched for destination ${toAddress}`);
      return { unmapped: true };
    }

    const storeId = matchedChannel.store_id;

    // 1. Resolve or create unified customer
    const customer = await StoreService.findOrCreateCustomer(storeId, {
      name: senderName,
      email: senderEmail,
    });

    // 2. Resolve or create the email conversation. A reply to a message we already have (In-Reply-To /
    //    References, including our own outgoing messages) belongs to the same thread.
    const refIds = [inReplyTo, ...String(references || '').split(/\s+/)].filter(Boolean);
    const known = StoreService.readLocalDb();
    const threadMsg = refIds.length ? known.conversation_messages.find((m) => m.store_id === storeId && refIds.includes(m.external_message_id)) : null;
    let externalThreadId = threadMsg ? known.conversations.find((c) => c.id === threadMsg.conversation_id)?.external_thread_id : inReplyTo || messageId;
    let conv = await StoreService.findOrCreateConversation(storeId, {
      channel_id: matchedChannel.id,
      channel_type: 'email',
      customer_id: customer.id,
      external_thread_id: externalThreadId,
      subject: subject.replace(/^Re:\s*/i, '').trim(),
      last_message_preview: textBody.slice(0, 140),
      is_incoming: true,
      metadata: {
        to_email: toAddress,
        from_email: senderEmail,
        message_id: messageId,
        in_reply_to: inReplyTo,
        references,
      },
    });

    // 3. Add message to conversation
    const message = await StoreService.addConversationMessage(storeId, conv.id, {
      external_message_id: messageId,
      sender_type: 'customer',
      sender_name: senderName,
      sender_id: senderEmail,
      message_text: textBody || '(Empty email body)',
      message_type: 'text',
      attachments: payload.attachments || [],
      status: 'delivered',
      metadata: {
        subject,
        html_body: htmlBody,
        message_id: messageId,
      },
    });

    require('./auto-reply.service').maybeAutoReply(storeId, conv.id);
    return { success: true, storeId, conversationId: conv.id, messageId: message.id };
  },

  /**
   * Send outbound email reply as agent / AI
   */
  async sendEmailReply(storeId, conversationId, replyText, senderName = 'Support Team', opts = {}) {
    const conv = await StoreService.getConversationWithDetails(storeId, conversationId);
    if (!conv) throw new Error('Conversation not found.');

    const customer = conv.customer;
    if (!customer?.email) throw new Error('Customer does not have an email address on file.');

    const channel = conv.channel;
    const fromAddress = channel?.account_id || process.env.SMTP_FROM_EMAIL || 'support@thesellsphere.com';
    const store = await StoreService.getStoreByIdWithoutUser(storeId);
    const storeName = store ? store.name : 'DB Tech Support';

    const lastMsgMeta = conv.messages?.[conv.messages.length - 1]?.metadata || {};
    const inReplyTo = lastMsgMeta.message_id || conv.metadata?.message_id;

    const transporter = getMailTransporter();
    const mailOptions = {
      from: `"${storeName} Support" <${fromAddress}>`,
      to: customer.email,
      subject: conv.subject?.startsWith('Re:') ? conv.subject : `Re: ${conv.subject || 'Support Ticket'}`,
      text: replyText,
      ...(inReplyTo && {
        inReplyTo,
        references: inReplyTo,
      }),
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`✉️ [SupportChannels] Email reply sent to ${customer.email}:`, info.messageId);

      // Record outbound message in conversation
      const sentMsg = await StoreService.addConversationMessage(storeId, conversationId, {
        external_message_id: info.messageId,
        sender_type: opts.senderType || 'agent',
        sender_name: opts.senderType === 'ai' ? 'Store AI' : senderName,
        message_text: replyText,
        message_type: 'text',
        status: 'sent',
      });

      return sentMsg;
    } catch (err) {
      console.error('[SupportChannels] sendEmailReply error:', err.message);
      throw new Error(`Failed to deliver email reply: ${err.message}`);
    }
  },

  // ── 3. META WEBHOOK INGESTION (MESSAGES, COMMENTS, AD COMMENTS) ────────────

  /**
   * Verify Meta Webhook Challenge (GET)
   */
  verifyMetaWebhook(mode, verifyToken, challenge) {
    if (mode === 'subscribe' && verifyToken === META_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  },

  /**
   * Handle incoming Meta Webhook event (Facebook Messenger, IG DM, Post Comments, Ad Comments)
   */
  async handleMetaWebhookEvent(rawBody, signature, payload) {
    // 1. Cryptographic HMAC validation if secret configured
    // With a secret configured, an unsigned or wrongly signed request is rejected (a missing header must not skip the check).
    if (META_APP_SECRET) {
      if (!verifyMetaSignature(rawBody, META_APP_SECRET, signature)) {
        console.warn('[SupportChannels] ❌ Meta Webhook signature missing or invalid; event ignored.');
        return { rejected: true };
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.error('[SupportChannels] META_APP_SECRET is not set: refusing unsigned Meta webhooks in production.');
      return { rejected: true };
    }

    const { object, entry } = payload;
    if (!entry || !Array.isArray(entry)) return { unhandled: true };

    for (const item of entry) {
      const pageId = item.id;

      // ── A. FACEBOOK MESSENGER & INSTAGRAM DMS ─────────────────────────────
      if (item.messaging && Array.isArray(item.messaging)) {
        for (const msgEvent of item.messaging) {
          await this.processIncomingMetaMessage(pageId, msgEvent, object === 'instagram');
        }
      }

      // ── B. PAGE FEED / POST COMMENTS / AD COMMENTS ────────────────────────
      if (item.changes && Array.isArray(item.changes)) {
        for (const change of item.changes) {
          if (change.field === 'feed' || change.field === 'comments' || change.field === 'mentions') {
            await this.processIncomingMetaComment(pageId, change.value, object === 'instagram', change.field);
          }
        }
      }
    }

    return { success: true };
  },

  /**
   * Process incoming Messenger / Instagram DM
   */
  async processIncomingMetaMessage(recipientAccountId, msgEvent, isInstagram = false) {
    // Delivery / read receipts, reactions and postbacks arrive on the same webhook but are not messages.
    const m = msgEvent.message;
    if (!m) return;
    const isEcho = !!m.is_echo; // a message the business sent from the Page / Instagram app itself
    const customerId = isEcho ? msgEvent.recipient?.id : msgEvent.sender?.id;
    if (!customerId) return;

    // Find store support channel by Page ID / Instagram Account ID
    const channelType = isInstagram ? 'instagram' : 'facebook';
    const channel = await StoreService.findSupportChannelGlobal(channelType, recipientAccountId);
    if (!channel) {
      console.warn(`[SupportChannels] No channel found for Meta recipient ${recipientAccountId}`);
      return;
    }
    const storeId = channel.store_id;

    // Redelivery guard (Meta retries until it gets a 200) and our own API sends coming back as echoes.
    const known = StoreService.readLocalDb();
    if (m.mid && known.conversation_messages.some((x) => x.store_id === storeId && x.external_message_id === m.mid)) return;

    const attachments = (m.attachments || []).map((a) => ({ type: a.type, url: a.payload?.url || null }));
    const label = { image: 'Sent a photo', video: 'Sent a video', audio: 'Sent a voice message', story_mention: 'Mentioned you in a story', share: 'Shared a post', ig_reel: 'Shared a reel', file: 'Sent a file' };
    const messageText = m.text || (attachments.length ? label[attachments[0].type] || 'Sent an attachment' : '');
    if (!messageText && !attachments.length) return;

    // 1. Customer resolution (placeholder name first, the real profile is looked up below)
    const customer = await StoreService.findOrCreateCustomer(storeId, {
      name: isInstagram ? `Instagram User (${customerId.slice(-4)})` : `Facebook User (${customerId.slice(-4)})`,
      ...(isInstagram ? { instagram_id: customerId } : { facebook_psid: customerId }),
    });
    if (/^(Instagram|Facebook) User \(/.test(customer.name)) {
      const profile = await this.lookupProfile(channel, customerId, isInstagram);
      if (profile?.name) {
        await StoreService.updateCustomerProfile(storeId, customer.id, { name: profile.name, avatar_url: profile.avatar });
        customer.name = profile.name;
      }
    }

    // 2. Conversation resolution
    const conv = await StoreService.findOrCreateConversation(storeId, {
      channel_id: channel.id,
      channel_type: isInstagram ? 'instagram_dm' : 'facebook_messenger',
      customer_id: customer.id,
      external_thread_id: customerId,
      last_message_preview: messageText,
      is_incoming: !isEcho,
      unread_count: isEcho ? 0 : undefined,
      metadata: { platform_user_id: customerId, recipient_account_id: recipientAccountId },
    });

    // 3. Message insertion
    await StoreService.addConversationMessage(storeId, conv.id, {
      external_message_id: m.mid,
      sender_type: isEcho ? 'agent' : 'customer',
      sender_name: isEcho ? channel.name : customer.name,
      sender_id: isEcho ? recipientAccountId : customerId,
      message_text: messageText,
      message_type: attachments.length > 0 ? attachments[0].type || 'image' : 'text',
      attachments: attachments.filter((a) => a.url),
      status: 'delivered',
    });

    if (!isEcho) require('./auto-reply.service').maybeAutoReply(storeId, conv.id);
  },

  /** Who is this Messenger / Instagram user? Best effort: permissions or privacy settings may refuse. */
  async lookupProfile(channel, userId, isInstagram) {
    try {
      const token = decrypt(channel.credentials_encrypted);
      const r = await axios.get(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v20.0'}/${userId}`, {
        params: { fields: isInstagram ? 'name,username,profile_pic' : 'name,profile_pic', access_token: token },
        timeout: 6000,
      });
      const name = r.data?.name || r.data?.username || '';
      return name ? { name, avatar: r.data?.profile_pic || null } : null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Register this server's webhook with the Meta app for Pages and Instagram (what the App Dashboard's
   * Webhooks screen does by hand). Operator action, run once per environment.
   */
  async registerMetaWebhooks() {
    if (!META_APP_ID || !META_APP_SECRET) throw new Error('META_APP_ID and META_APP_SECRET are not configured on the server.');
    const callbackUrl = `${BACKEND_URL}/api/support-channels/meta/webhook`;
    const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
    const wanted = [
      { object: 'page', fields: 'feed,messages,messaging_postbacks' },
      { object: 'instagram', fields: 'comments,messages,mentions' },
    ];
    const results = [];
    for (const w of wanted) {
      try {
        await axios.post(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v20.0'}/${META_APP_ID}/subscriptions`, null, {
          params: { object: w.object, callback_url: callbackUrl, fields: w.fields, verify_token: META_VERIFY_TOKEN, access_token: appToken },
          timeout: 20000,
        });
        results.push({ object: w.object, fields: w.fields, ok: true });
      } catch (e) {
        results.push({ object: w.object, fields: w.fields, ok: false, error: e.response?.data?.error?.message || e.message });
      }
    }
    return { callback_url: callbackUrl, results };
  },

  /**
   * Process incoming Post Comment or Ad Comment
   */
  async processIncomingMetaComment(pageId, changeValue, isInstagram = false, field = '') {
    if (!changeValue) return;

    // Facebook sends item === 'comment' with a verb; Instagram sends the "comments" field with no item.
    if (isInstagram) {
      if (field && field !== 'comments') return;
    } else {
      if (changeValue.item !== 'comment') return;
      if (changeValue.verb && changeValue.verb !== 'add') return; // edited / removed comments are not new messages
    }

    const commentId = changeValue.comment_id || changeValue.id;
    const postId = changeValue.post_id || changeValue.media?.id || null;
    const parentId = changeValue.parent_id || postId;
    const message = changeValue.message || changeValue.text || '';
    const from = changeValue.from || {};
    const senderId = from.id;
    const senderName = from.name || (isInstagram ? from.username || 'Instagram User' : 'Facebook User');
    if (!commentId || !message) return;

    // Ad Comment Detection: Check if post_id or parent_id belongs to an ad or has ad metadata
    const isAd = !!(changeValue.ad_id || changeValue.ad_name || changeValue.is_ad || (parentId && String(parentId).startsWith('act_')));
    const adId = changeValue.ad_id || null;
    const adName = changeValue.ad_name || (isAd ? 'Sponsored Post / Ad' : null);

    // Resolve store
    const channelType = isInstagram ? 'instagram' : 'facebook';
    const channel = await StoreService.findSupportChannelGlobal(channelType, pageId);
    if (!channel) return;

    const storeId = channel.store_id;

    // A comment written by the Page itself: either our own API reply coming back (already stored) or a person
    // answering natively in the Facebook / Instagram app, which we add to the customer's thread.
    if (senderId === pageId) {
      const known = StoreService.readLocalDb();
      if (known.conversation_messages.some((m) => m.store_id === storeId && m.external_message_id === String(commentId))) return;
      const parent = changeValue.parent_id && known.conversations.find((c) => c.store_id === storeId && c.external_thread_id === String(changeValue.parent_id));
      if (parent) {
        await StoreService.addConversationMessage(storeId, parent.id, {
          external_message_id: commentId, sender_type: 'agent', sender_name: channel.name, message_text: message, message_type: 'comment', status: 'delivered',
        });
      }
      return;
    }

    // Resolve unified customer
    const customer = await StoreService.findOrCreateCustomer(storeId, {
      name: senderName,
      ...(isInstagram ? { instagram_id: senderId } : { facebook_psid: senderId }),
    });

    const determinedChannelType = isInstagram
      ? isAd ? 'instagram_ad_comment' : 'instagram_comment'
      : isAd ? 'facebook_ad_comment' : 'facebook_comment';

    // Conversation thread keyed by commentId or parent post
    const conv = await StoreService.findOrCreateConversation(storeId, {
      channel_id: channel.id,
      channel_type: determinedChannelType,
      customer_id: customer.id,
      external_thread_id: commentId,
      subject: isAd ? `Ad Comment: ${adName || 'Ad Interaction'}` : `Comment on Post`,
      last_message_preview: message,
      is_incoming: true,
      metadata: {
        comment_id: commentId,
        parent_id: parentId,
        post_id: postId,
        is_ad: isAd,
        ad_id: adId,
        ad_name: adName,
        permalink_url: changeValue.permalink_url || null,
        can_reply_privately: true,
      },
    });

    // Add message
    await StoreService.addConversationMessage(storeId, conv.id, {
      external_message_id: commentId,
      sender_type: 'customer',
      sender_name: senderName,
      sender_id: senderId,
      message_text: message,
      message_type: 'comment',
      metadata: {
        comment_id: commentId,
        parent_id: parentId,
        is_ad: isAd,
        ad_id: adId,
      },
    });

    // Attach the post the customer commented on (cached after the first lookup) so the inbox and AI have context.
    if (postId) {
      try {
        const Posts = require('./social/posts');
        const post = Posts.summary(await Posts.ensurePost(storeId, channel, postId, { isInstagram, isAd, adName }));
        if (post) await StoreService.updateConversation(storeId, conv.id, { metadata: { ...(conv.metadata || {}), post } });
      } catch (e) {
        console.warn('[SupportChannels] post context lookup failed:', e.message);
      }
    }

    require('./auto-reply.service').maybeAutoReply(storeId, conv.id);
  },

  // ── 4. OUTBOUND ACTIONS: REPLY, LIKE, DELETE, PRIVATE DM ───────────────────

  /**
   * Reply to a Facebook or Instagram comment
   */
  async replyToComment(storeId, conversationId, replyText, opts = {}) {
    const conv = await StoreService.getConversationWithDetails(storeId, conversationId);
    if (!conv) throw new Error('Conversation not found.');

    const channel = await StoreService.getSupportChannelById(storeId, conv.channel_id);
    if (!channel || !channel.credentials_encrypted) {
      throw new Error('Channel credentials not found.');
    }

    const token = decrypt(channel.credentials_encrypted);
    const commentId = conv.metadata?.comment_id || conv.external_thread_id;
    const isInstagram = conv.channel_type.includes('instagram');

    const endpoint = isInstagram
      ? `https://graph.facebook.com/v20.0/${commentId}/replies`
      : `https://graph.facebook.com/v20.0/${commentId}/comments`;

    try {
      const res = await axios.post(
        endpoint,
        { message: replyText },
        { params: { access_token: token }, timeout: 10000 }
      );

      // Record outbound reply in database
      const sentMsg = await StoreService.addConversationMessage(storeId, conversationId, {
        external_message_id: res.data?.id,
        sender_type: opts.senderType || 'agent',
        sender_name: opts.senderName || 'Agent',
        message_text: replyText,
        message_type: 'comment',
        status: 'delivered',
      });

      return sentMsg;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`Failed to post comment reply: ${msg}`);
    }
  },

  /**
   * Like a Facebook or Instagram comment
   */
  async likeComment(storeId, conversationId) {
    const conv = await StoreService.getConversationWithDetails(storeId, conversationId);
    if (!conv) throw new Error('Conversation not found.');

    const channel = await StoreService.getSupportChannelById(storeId, conv.channel_id);
    if (!channel || !channel.credentials_encrypted) throw new Error('Channel credentials not found.');

    if (conv.channel_type.includes('instagram')) throw new Error('Instagram does not allow liking comments through its API. Reply to the comment instead.');
    const token = decrypt(channel.credentials_encrypted);
    const commentId = conv.metadata?.comment_id || conv.external_thread_id;

    try {
      await axios.post(
        `https://graph.facebook.com/v20.0/${commentId}/likes`,
        null,
        { params: { access_token: token }, timeout: 10000 }
      );
      return { success: true, commentId };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`Failed to like comment: ${msg}`);
    }
  },

  /**
   * Delete a Facebook or Instagram comment
   */
  async deleteComment(storeId, conversationId) {
    const conv = await StoreService.getConversationWithDetails(storeId, conversationId);
    if (!conv) throw new Error('Conversation not found.');

    const channel = await StoreService.getSupportChannelById(storeId, conv.channel_id);
    if (!channel || !channel.credentials_encrypted) throw new Error('Channel credentials not found.');

    const token = decrypt(channel.credentials_encrypted);
    const commentId = conv.metadata?.comment_id || conv.external_thread_id;

    try {
      await axios.delete(`https://graph.facebook.com/v20.0/${commentId}`, {
        params: { access_token: token },
        timeout: 10000,
      });

      await StoreService.updateConversation(storeId, conversationId, { status: 'closed' });
      return { success: true, deleted: true };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`Failed to delete comment: ${msg}`);
    }
  },

  /**
   * Send Private Reply / Direct Message from Comment (DelightChat feature)
   */
  async sendPrivateReplyFromComment(storeId, conversationId, messageText, opts = {}) {
    const conv = await StoreService.getConversationWithDetails(storeId, conversationId);
    if (!conv) throw new Error('Conversation not found.');

    const channel = await StoreService.getSupportChannelById(storeId, conv.channel_id);
    if (!channel || !channel.credentials_encrypted) throw new Error('Channel credentials not found.');

    const token = decrypt(channel.credentials_encrypted);
    const commentId = conv.metadata?.comment_id || conv.external_thread_id;
    const pageId = channel.settings?.parent_page_id || channel.account_id; // Instagram messages go out through the linked Page

    try {
      // Official Meta Private Replies Endpoint
      const res = await axios.post(
        `https://graph.facebook.com/v20.0/${pageId}/messages`,
        {
          recipient: { comment_id: commentId },
          message: { text: messageText },
        },
        { params: { access_token: token }, timeout: 10000 }
      );

      const sentMsg = await StoreService.addConversationMessage(storeId, conversationId, {
        external_message_id: res.data?.message_id,
        sender_type: opts.senderType || 'agent',
        sender_name: opts.senderName ? `${opts.senderName} (private message)` : 'Agent (private message)',
        message_text: messageText,
        message_type: 'text',
        metadata: { private_dm: true },
        status: 'delivered',
      });

      return sentMsg;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`Private DM from comment failed: ${msg}`);
    }
  },

  /**
   * Send direct Messenger or Instagram DM reply
   */
  async sendDirectMessage(storeId, conversationId, messageText, opts = {}) {
    const conv = await StoreService.getConversationWithDetails(storeId, conversationId);
    if (!conv) throw new Error('Conversation not found.');

    const channel = await StoreService.getSupportChannelById(storeId, conv.channel_id);
    if (!channel || !channel.credentials_encrypted) throw new Error('Channel credentials not found.');

    const token = decrypt(channel.credentials_encrypted);
    const recipientId = conv.metadata?.platform_user_id || conv.external_thread_id;
    const pageId = channel.settings?.parent_page_id || channel.account_id; // Instagram messages go out through the linked Page

    try {
      const res = await axios.post(
        `https://graph.facebook.com/v20.0/${pageId}/messages`,
        {
          recipient: { id: recipientId },
          message: { text: messageText },
        },
        { params: { access_token: token }, timeout: 10000 }
      );

      // Product photos go as separate image attachments (Messenger / Instagram format)
      const sentImages = [];
      for (const img of opts.images || []) {
        try {
          await axios.post(
            `https://graph.facebook.com/v20.0/${pageId}/messages`,
            {
              recipient: { id: recipientId },
              message: { attachment: { type: 'image', payload: { url: img.url, is_reusable: true } } },
            },
            { params: { access_token: token }, timeout: 10000 }
          );
          sentImages.push({ type: 'image', url: img.url, caption: img.caption });
        } catch (imgErr) {
          console.warn('[SupportChannels] Product image send failed:', imgErr.response?.data?.error?.message || imgErr.message);
        }
      }

      const sentMsg = await StoreService.addConversationMessage(storeId, conversationId, {
        external_message_id: res.data?.message_id,
        sender_type: opts.senderType || 'agent',
        sender_name: opts.senderName || 'Agent',
        message_text: messageText,
        message_type: 'text',
        attachments: sentImages,
        status: 'delivered',
      });

      return sentMsg;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`Message delivery failed: ${msg}`);
    }
  },
};

module.exports = SupportChannelsService;

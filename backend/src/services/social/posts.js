const axios = require('axios');
const crypto = require('crypto');
const StoreService = require('../store.service');
const { decrypt } = require('../../utils/crypto');

const V = () => process.env.META_GRAPH_VERSION || 'v20.0';
const G = () => `https://graph.facebook.com/${V()}`;

const errMsg = (e) => e.response?.data?.error?.message || e.message;

function posts() {
  const db = StoreService.readLocalDb();
  if (!Array.isArray(db.posts)) db.posts = [];
  return db;
}

const keyOf = (channelId, postId) => `${channelId}:${postId}`;

/** Graph timestamps look like 2026-10-02T09:00:00+0000; store plain ISO so they sort and parse everywhere. */
const iso = (v) => {
  const d = new Date(v);
  return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

/** Fetch one post / media item from the platform, using the connected Page's token. */
async function fetchPost(channel, postId, isInstagram) {
  const token = decrypt(channel.credentials_encrypted);
  if (isInstagram) {
    const r = await axios.get(`${G()}/${postId}`, {
      params: { fields: 'caption,permalink,media_url,thumbnail_url,timestamp,media_type,comments_count', access_token: token },
      timeout: 15000,
    });
    const d = r.data;
    return { message: d.caption || '', permalink_url: d.permalink || null, picture: d.media_type === 'VIDEO' ? d.thumbnail_url || null : d.media_url || null, media_type: d.media_type || null, created_time: iso(d.timestamp), comments_count: d.comments_count ?? null };
  }
  const r = await axios.get(`${G()}/${postId}`, {
    params: { fields: 'message,story,permalink_url,full_picture,created_time,attachments{title,description,type}', access_token: token },
    timeout: 15000,
  });
  const d = r.data;
  const att = d.attachments?.data?.[0];
  return {
    message: d.message || d.story || att?.description || att?.title || '',
    permalink_url: d.permalink_url || null,
    picture: d.full_picture || null,
    media_type: att?.type || null,
    created_time: iso(d.created_time),
    comments_count: null,
  };
}

/**
 * The post a comment was made on: cached after the first fetch. Never throws; if the platform refuses
 * (permissions, deleted post, ad post) the AI simply gets less context and the UI says so.
 */
async function ensurePost(storeId, channel, postId, { isInstagram = false, isAd = false, adName = null } = {}) {
  if (!postId) return null;
  const k = keyOf(channel.id, postId);
  const db = posts();
  let rec = db.posts.find((p) => p.store_id === storeId && p.key === k);
  if (rec && rec.message !== undefined && Date.now() - new Date(rec.fetched_at).getTime() < 24 * 3600 * 1000) return rec;

  let data = {};
  let fetchError = null;
  try {
    data = await fetchPost(channel, postId, isInstagram);
  } catch (e) {
    fetchError = errMsg(e);
  }

  const fresh = StoreService.readLocalDb();
  if (!Array.isArray(fresh.posts)) fresh.posts = [];
  rec = fresh.posts.find((p) => p.store_id === storeId && p.key === k);
  const merged = {
    id: rec?.id || crypto.randomUUID(),
    key: k,
    store_id: storeId,
    channel_id: channel.id,
    platform: isInstagram ? 'instagram' : 'facebook',
    post_id: postId,
    message: '',
    permalink_url: null,
    picture: null,
    media_type: null,
    created_time: null,
    comments_count: null,
    ...(rec || {}),
    ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined)),
    is_ad: isAd || rec?.is_ad || false,
    ad_name: adName || rec?.ad_name || null,
    fetch_error: fetchError,
    fetched_at: new Date().toISOString(),
  };
  if (rec) Object.assign(rec, merged);
  else fresh.posts.push(merged);
  StoreService.writeLocalDb(fresh);
  return merged;
}

function getPostByKey(storeId, channelId, postId) {
  return posts().posts.find((p) => p.store_id === storeId && p.key === keyOf(channelId, postId)) || null;
}

/** Compact post summary stored on a conversation so the inbox and the AI never need a second lookup. */
function summary(p) {
  if (!p) return null;
  return {
    id: p.post_id,
    platform: p.platform,
    message: p.message || '',
    permalink_url: p.permalink_url,
    picture: p.picture,
    created_time: p.created_time,
    is_ad: !!p.is_ad,
    ad_name: p.ad_name || null,
    unavailable: !p.message && !!p.fetch_error,
  };
}

/** Posts that have comments in the inbox, newest activity first. */
function listPosts(storeId, { channelType } = {}) {
  const db = posts();
  const comments = db.conversations.filter((c) => c.store_id === storeId && String(c.channel_type).includes('comment'));
  const byPost = new Map();
  for (const c of comments) {
    const pid = c.metadata?.post_id || c.metadata?.parent_id;
    if (!pid) continue;
    const k = `${c.channel_id}:${pid}`;
    const e = byPost.get(k) || { key: k, channel_id: c.channel_id, post_id: pid, total: 0, unread: 0, unreplied: 0, last_activity: c.last_message_at, is_ad: false };
    e.total += 1;
    if ((c.unread_count || 0) > 0) e.unread += 1;
    const msgs = db.conversation_messages.filter((m) => m.conversation_id === c.id && !m.is_private_note);
    if (!msgs.some((m) => m.sender_type === 'agent' || m.sender_type === 'ai')) e.unreplied += 1;
    if (new Date(c.last_message_at) > new Date(e.last_activity)) e.last_activity = c.last_message_at;
    if (c.metadata?.is_ad) e.is_ad = true;
    byPost.set(k, e);
  }
  const out = [];
  for (const e of byPost.values()) {
    const rec = db.posts.find((p) => p.store_id === storeId && p.key === e.key);
    const ch = db.support_channels.find((x) => x.id === e.channel_id);
    const platform = rec?.platform || (ch?.channel_type === 'instagram' ? 'instagram' : 'facebook');
    if (channelType && channelType !== 'all' && channelType !== 'comments' && !String(channelType).startsWith(platform)) continue;
    out.push({ ...e, platform, channel_name: ch?.name || null, post: summary(rec) || { id: e.post_id, platform, message: '', permalink_url: null, picture: null, created_time: null, is_ad: e.is_ad, ad_name: null, unavailable: true } });
  }
  return out.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
}

// ── Backfill: pull recent posts and their comments from the platform ─────────

async function importComment({ storeId, channel, post, isInstagram, c, replies }) {
  const pageId = channel.account_id;
  const username = channel.settings?.username;
  const isOwn = (from) => !!from && (String(from.id) === String(pageId) || (isInstagram && username && from.username === username));
  const nameOf = (x) => x.from?.name || x.from?.username || x.username || (isInstagram ? 'Instagram User' : 'Facebook User');
  const idOf = (x) => x.from?.id || x.username || x.id;
  const text = (x) => x.message || x.text || '';
  const when = (x) => iso(x.created_time || x.timestamp) || new Date().toISOString();

  if (isOwn(c.from)) return 0; // our own top-level comment is not a customer thread
  const db = StoreService.readLocalDb();
  const exists = db.conversations.find((v) => v.store_id === storeId && v.external_thread_id === String(c.id));
  if (exists) return 0;

  const customer = await StoreService.findOrCreateCustomer(storeId, {
    name: nameOf(c),
    ...(isInstagram ? { instagram_id: idOf(c) } : { facebook_psid: idOf(c) }),
  });
  const conv = await StoreService.findOrCreateConversation(storeId, {
    channel_id: channel.id,
    channel_type: isInstagram ? (post.is_ad ? 'instagram_ad_comment' : 'instagram_comment') : post.is_ad ? 'facebook_ad_comment' : 'facebook_comment',
    customer_id: customer.id,
    external_thread_id: c.id,
    subject: 'Comment on Post',
    last_message_preview: text(c),
    unread_count: 0,
    created_at: when(c),
    metadata: { comment_id: c.id, post_id: post.post_id, parent_id: post.post_id, is_ad: !!post.is_ad, permalink_url: post.permalink_url, can_reply_privately: true, imported: true, post: summary(post) },
  });
  await StoreService.addConversationMessage(storeId, conv.id, {
    external_message_id: c.id, sender_type: 'customer', sender_name: nameOf(c), sender_id: idOf(c), message_text: text(c), message_type: 'comment', status: 'delivered', created_at: when(c), silent: true,
  });
  for (const r of replies || []) {
    const own = isOwn(r.from);
    await StoreService.addConversationMessage(storeId, conv.id, {
      external_message_id: r.id,
      sender_type: own ? 'agent' : 'customer',
      sender_name: own ? channel.name : nameOf(r),
      sender_id: idOf(r),
      message_text: text(r),
      message_type: 'comment',
      status: 'delivered',
      created_at: when(r),
      silent: true,
    });
  }
  return 1;
}

/**
 * Import the latest posts and their comments of one connected Page / Instagram account.
 * Official Graph API: /{page}/posts with nested comments, /{ig-user}/media with nested comments.
 * Nothing is auto-replied for imported history.
 */
async function syncChannelPosts(storeId, channelId, { limit = 15 } = {}) {
  const channel = await StoreService.getSupportChannelById(storeId, channelId);
  if (!channel || channel.status !== 'connected' || !channel.credentials_encrypted) throw new Error('This channel is not connected.');
  if (!['facebook', 'instagram'].includes(channel.channel_type)) throw new Error('Post sync is only available for Facebook and Instagram.');
  const isInstagram = channel.channel_type === 'instagram';
  const token = decrypt(channel.credentials_encrypted);
  const n = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50);

  let items;
  try {
    if (isInstagram) {
      const r = await axios.get(`${G()}/${channel.account_id}/media`, {
        params: { fields: 'id,caption,permalink,media_url,thumbnail_url,timestamp,media_type,comments_count,comments.limit(50){id,text,username,timestamp,from,replies.limit(20){id,text,username,timestamp,from}}', limit: n, access_token: token },
        timeout: 30000,
      });
      items = r.data?.data || [];
    } else {
      const r = await axios.get(`${G()}/${channel.account_id}/posts`, {
        params: { fields: 'id,message,story,permalink_url,full_picture,created_time,comments.limit(50){id,message,from,created_time,comments.limit(20){id,message,from,created_time}}', limit: n, access_token: token },
        timeout: 30000,
      });
      items = r.data?.data || [];
    }
  } catch (e) {
    throw new Error(`Could not read posts from ${isInstagram ? 'Instagram' : 'Facebook'}: ${errMsg(e)}`);
  }

  let postsSeen = 0;
  let commentsImported = 0;
  for (const it of items) {
    const rec = await ensurePost(storeId, channel, it.id, { isInstagram });
    // use the data we already have instead of a second request
    const fresh = StoreService.readLocalDb();
    const stored = (fresh.posts || []).find((p) => p.store_id === storeId && p.key === keyOf(channel.id, it.id));
    if (stored) {
      stored.message = (isInstagram ? it.caption : it.message || it.story) || stored.message || '';
      stored.permalink_url = (isInstagram ? it.permalink : it.permalink_url) || stored.permalink_url;
      stored.picture = (isInstagram ? (it.media_type === 'VIDEO' ? it.thumbnail_url : it.media_url) : it.full_picture) || stored.picture;
      stored.created_time = iso(it.timestamp || it.created_time) || stored.created_time;
      stored.comments_count = it.comments_count ?? stored.comments_count;
      StoreService.writeLocalDb(fresh);
    }
    const post = stored || rec;
    postsSeen++;
    for (const c of it.comments?.data || []) {
      const replies = isInstagram ? c.replies?.data : c.comments?.data;
      commentsImported += await importComment({ storeId, channel, post, isInstagram, c, replies });
    }
  }
  return { posts: postsSeen, comments_imported: commentsImported };
}

module.exports = { ensurePost, getPostByKey, summary, listPosts, syncChannelPosts, keyOf };

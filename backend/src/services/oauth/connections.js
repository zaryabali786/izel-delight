const crypto = require('crypto');
const StoreService = require('../store.service');
const ShopifyService = require('../shopify.service');
const { encrypt, decrypt } = require('../../utils/crypto');
const { backendUrl, frontendUrl } = require('../../utils/urls');
const { emitToStore } = require('../realtime.service');
const Connectors = require('../marketing/connectors');
const Credentials = require('./credentials');
const IntegrationsService = require('../integrations.service');
const { PROVIDERS, readiness, errMsg } = require('./providers');

const STATE_TTL_MS = 15 * 60 * 1000;

// ── Signed OAuth state (CSRF protection + carries store/user across the redirect) ──

const stateKey = () => crypto.createHash('sha256').update(String(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'oauth-state-key')).digest();

function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, nonce: crypto.randomBytes(8).toString('hex'), exp: Date.now() + STATE_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) throw new Error('Invalid OAuth state.');
  const expected = crypto.createHmac('sha256', stateKey()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('OAuth state signature mismatch.');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!data.exp || data.exp < Date.now()) throw new Error('The connection attempt expired. Please try again.');
  return data;
}

/** Providers of one vendor (all of Google) share a single registered redirect URI. */
const callbackKey = (providerId) => PROVIDERS[providerId]?.callback || providerId;
const redirectUriFor = (providerId) => `${backendUrl()}/api/connections/callback/${callbackKey(providerId)}`;

// ── Integration storage helpers ──────────────────────────────────────────────

function getIntegration(storeId, providerId) {
  return StoreService.readLocalDb().integrations.find((i) => i.store_id === storeId && i.provider === providerId) || null;
}

function accountsOf(integ) {
  return Array.isArray(integ?.config?.accounts) ? integ.config.accounts : [];
}

/** Public (secret-free) view of one connection. */
function publicView(integ) {
  if (!integ) return null;
  const c = integ.config || {};
  return {
    status: integ.status,
    connected_via: c.connected_via || null,
    identity: c.identity || c.shop_domain || null,
    accounts: accountsOf(integ),
    expires_at: c.expires_at || null,
    last_synced_at: integ.last_synced_at || null,
    account_error: c.account_error || null,
    verification: c.verification || null,
  };
}

// ── OAuth start / callback ───────────────────────────────────────────────────

/** The store's own myshopify domain, so the merchant never has to type it again. */
async function knownShop(storeId) {
  const integ = getIntegration(storeId, 'shopify');
  const store = await StoreService.getStoreByIdWithoutUser(storeId);
  for (const c of [integ?.config?.shop_domain, store?.settings?.shop_domain, store?.domain]) {
    const v = String(c || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (v !== 'store.myshopify.com' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(v)) return v; // skip the old placeholder
  }
  return null;
}

const MESSAGING_ENV = ['META_APP_ID', 'META_APP_SECRET'];

async function start(storeId, userId, providerId, { shop } = {}) {
  if (providerId === 'shopify') {
    if (!process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET) {
      throw new Error('Shopify sign-in is not available yet.');
    }
    const domain = shop || (await knownShop(storeId));
    if (!domain) {
      const err = new Error('Enter your Shopify store address (your-store.myshopify.com).');
      err.code = 'shop_required';
      throw err;
    }
    return { authUrl: ShopifyService.generateAuthUrl(domain, storeId, userId, { popup: true }) };
  }

  if (providerId === 'meta-messaging' || providerId === 'instagram-inbox') {
    const missing = MESSAGING_ENV.filter((k) => !process.env[k]);
    if (missing.length) throw new Error('Facebook and Instagram sign-in is not available yet.');
    const SupportChannels = require('../support-channels.service');
    return { authUrl: SupportChannels.getMetaOAuthUrl(storeId, userId, { popup: true }) };
  }

  const p = PROVIDERS[providerId];
  if (!p) throw new Error('This connector does not support one-click connect yet.');
  const r = readiness(providerId);
  if (!r.ready) throw new Error(`${p.label} sign-in is not available yet.`);

  // PKCE: the verifier travels sealed (encrypted) inside the signed state, so the browser never sees it.
  const verifier = p.pkce ? crypto.randomBytes(48).toString('base64url') : null;
  const state = signState({ storeId, userId, provider: providerId, ...(verifier ? { cv: encrypt(verifier) } : {}) });
  return { authUrl: p.authorizeUrl({ redirectUri: redirectUriFor(providerId), state, codeVerifier: verifier }) };
}

async function handleCallback(routeKey, query) {
  if (query.error) throw new Error(query.error_description || query.error_message || String(query.error));

  const st = verifyState(query.state);
  const providerId = st.provider;
  const p = PROVIDERS[providerId];
  if (!p) throw new Error('Unknown provider.');
  if (callbackKey(providerId) !== routeKey) throw new Error('OAuth state does not match this provider.');
  const code = query[p.codeParam];
  if (!code) throw new Error('The provider did not return an authorization code.');

  let tokens;
  try {
    tokens = await p.exchange({ code, redirectUri: redirectUriFor(providerId), codeVerifier: st.cv ? decrypt(st.cv) : undefined });
  } catch (err) {
    throw new Error(`${p.label} sign-in failed: ${errMsg(err)}`);
  }

  let identity = '';
  let accounts = [];
  let accountError = null;
  try {
    if (p.identity) identity = await p.identity(tokens);
    accounts = await p.listAccounts(tokens);
  } catch (err) {
    accountError = errMsg(err); // tokens are still valid; surface the reason instead of failing the whole connect
  }

  // Keep the user's earlier account choices on reconnect; a lone account is selected automatically.
  const previous = accountsOf(getIntegration(st.storeId, providerId));
  const merged = accounts.map((a) => ({
    ...a,
    selected: previous.length ? previous.some((x) => x.id === a.id && x.selected) : accounts.length === 1,
  }));
  const firstSelected = merged.find((a) => a.selected);

  const config = {
    connected_via: 'oauth',
    identity,
    accounts: merged,
    account_error: accountError,
    accessToken_encrypted: encrypt(tokens.accessToken),
    ...(tokens.refreshToken ? { refreshToken_encrypted: encrypt(tokens.refreshToken) } : {}),
    expires_at: tokens.expiresAt || null,
    ...(tokens.extra ? { extra: tokens.extra } : {}),
    ...(firstSelected ? { adAccountId: firstSelected.id } : {}), // kept for code that predates multi-account
    verified_at: new Date().toISOString(),
  };
  await StoreService.updateStoreIntegration(st.storeId, st.userId, providerId, config, 'connected');
  emitToStore(st.storeId, 'integration:status_changed', { storeId: st.storeId, provider: providerId, status: 'connected' });
  return { storeId: st.storeId, provider: providerId, accounts: merged.length };
}

// ── API-key connectors (couriers, WhatsApp) ──────────────────────────────────

async function saveCredentials(storeId, userId, providerId, rawFields) {
  const schema = Credentials.SCHEMAS[providerId];
  if (!schema) throw new Error('This connector does not take API credentials.');
  const fields = Credentials.cleanFields(providerId, rawFields);

  if (schema.verify === 'live') {
    // Throws with the provider's real error message when the credentials are wrong.
    await IntegrationsService.validateProviderCredentials(providerId, fields);
  }
  await IntegrationsService.saveIntegration(storeId, userId, providerId, { ...fields, connected_via: 'api-key', verification: schema.verify === 'live' ? 'live' : 'unverified' });
  return { verified: schema.verify === 'live' };
}

// ── Accounts, disconnect, token access ───────────────────────────────────────

async function setSelectedAccounts(storeId, userId, providerId, selectedIds) {
  const integ = getIntegration(storeId, providerId);
  if (!integ || integ.status !== 'connected') throw new Error('Connect this platform first.');
  const ids = new Set((selectedIds || []).map(String));
  const accounts = accountsOf(integ).map((a) => ({ ...a, selected: ids.has(String(a.id)) }));
  const first = accounts.find((a) => a.selected);
  const config = { ...integ.config, accounts, adAccountId: first ? first.id : '' };
  await StoreService.updateStoreIntegration(storeId, userId, providerId, config, 'connected');
  return accounts;
}

async function disconnect(storeId, userId, providerId) {
  if (providerId === 'meta-messaging' || providerId === 'instagram-inbox') {
    const types = providerId === 'instagram-inbox' ? ['instagram'] : ['facebook'];
    const channels = StoreService.readLocalDb().support_channels.filter((c) => c.store_id === storeId && types.includes(c.channel_type));
    for (const ch of channels) await StoreService.updateSupportChannel(storeId, ch.id, { status: 'disconnected', credentials_encrypted: null });
    emitToStore(storeId, 'channels:updated', { storeId });
    return true;
  }
  if (providerId === 'shopify') {
    await ShopifyService.disconnectStore(storeId, userId);
    emitToStore(storeId, 'integration:status_changed', { storeId, provider: providerId, status: 'not_connected' });
    return true;
  }
  await StoreService.updateStoreIntegration(storeId, userId, providerId, { disconnected_at: new Date().toISOString() }, 'not_connected');
  emitToStore(storeId, 'integration:status_changed', { storeId, provider: providerId, status: 'not_connected' });
  return true;
}

/** Decrypted access token, refreshed first when it is about to expire (Google, Snapchat, Pinterest). */
async function getValidAccessToken(storeId, userIdArg, providerId) {
  const integ = getIntegration(storeId, providerId);
  const userId = userIdArg || integ?.user_id;
  const c = integ?.config;
  if (!integ || integ.status !== 'connected' || !c?.accessToken_encrypted) throw new Error('Not connected.');
  const p = PROVIDERS[providerId];
  const exp = c.expires_at ? new Date(c.expires_at).getTime() : null;

  if (exp && exp - Date.now() < 2 * 60 * 1000) {
    if (!p?.refresh || !c.refreshToken_encrypted) {
      await StoreService.updateStoreIntegration(storeId, userId, providerId, { ...c, account_error: 'Connection expired. Please reconnect.' }, 'needs_reauth');
      throw new Error('The connection expired. Please reconnect.');
    }
    try {
      const fresh = await p.refresh({ refreshToken: decrypt(c.refreshToken_encrypted) });
      const next = { ...c, accessToken_encrypted: encrypt(fresh.accessToken), expires_at: fresh.expiresAt || null };
      await StoreService.updateStoreIntegration(storeId, userId, providerId, next, 'connected');
      return fresh.accessToken;
    } catch (err) {
      await StoreService.updateStoreIntegration(storeId, userId, providerId, { ...c, account_error: errMsg(err) }, 'needs_reauth');
      throw new Error('Could not refresh the connection. Please reconnect.');
    }
  }
  return decrypt(c.accessToken_encrypted);
}

// ── Catalog for the Connectors page ──────────────────────────────────────────

const OAUTH_IDS = new Set(['shopify', 'meta-messaging', 'instagram-inbox', ...Object.keys(PROVIDERS)]);

function oauthReadiness(id) {
  if (id === 'shopify') {
    const missing = ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'].filter((k) => !process.env[k]);
    return { ready: missing.length === 0, missing };
  }
  if (id === 'meta-messaging' || id === 'instagram-inbox') {
    const missing = MESSAGING_ENV.filter((k) => !process.env[k]);
    return { ready: missing.length === 0, missing };
  }
  return readiness(id);
}

const WA_ENV = ['META_APP_ID', 'META_APP_SECRET', 'META_WA_CONFIG_ID'];

/** Plain-language description of what each connection is allowed to do, shown before the customer signs in. */
const ACCESS = {
  shopify: ['Your products, variants and inventory', 'Orders, customers and fulfilment status', 'Real-time updates through webhooks, so the dashboard stays current'],
  'meta-ads': ['Ad accounts, campaigns and spend (read-only)', 'Purchases and conversion values reported by Meta', 'We cannot create or edit ads, or spend money'],
  'meta-messaging': ['Messenger conversations with your customers', 'Comments on your Page posts and ads', 'Replies on your behalf, including AI replies you switch on'],
  'instagram-inbox': ['Direct messages sent to your Instagram professional account', 'Comments on your posts, reels and ads', 'Replies on your behalf, including AI replies you switch on', 'Instagram connects through your Facebook login: the account must be linked to one of your Facebook Pages'],
  'google-ads': ['Campaign performance and spend', 'Google offers a single permission for the Ads API; we only read reports'],
  ga4: ['Read-only access to your Google Analytics 4 properties'],
  gsc: ['Read-only access to your Search Console sites'],
  'tiktok-ads': ['Advertiser accounts and reporting (read-only)'],
  'snapchat-ads': ['Ad accounts and reporting (read-only)'],
  'pinterest-ads': ['Ad accounts and analytics (read-only)'],
  'bing-ads': ['Sign-in with Microsoft Advertising (account list and sync are coming)'],
  klaviyo: ['Your Klaviyo account name', 'Lists and profiles, to add your audiences to Klaviyo lists'],
  'whatsapp-business': ['Your WhatsApp Business number and its conversations', 'Send replies and product photos to customers who message you'],
};

/** Connected Facebook Pages / Instagram accounts, shown as a read-only account list. */
function messagingView(storeId, types = ['facebook', 'instagram']) {
  const channels = StoreService.readLocalDb().support_channels.filter(
    (c) => c.store_id === storeId && types.includes(c.channel_type) && c.status === 'connected'
  );
  if (channels.length === 0) return null;
  return {
    status: 'connected',
    connected_via: 'oauth',
    identity: null,
    accounts: channels.map((c) => ({ id: c.id, name: c.name, selected: true })),
    accounts_readonly: true,
    expires_at: null,
    last_synced_at: null,
    account_error: null,
    verification: null,
  };
}

/**
 * @param {{operator?: boolean}} opts operator=true also receives setup help (missing env vars, redirect URIs);
 *   ordinary customers only ever see "not available yet" for platforms the operator has not enabled.
 */
function catalog(storeId, { operator = false } = {}) {
  const base = Connectors.catalog(storeId);
  return base.map((c) => {
    const integ = c.integration ? getIntegration(storeId, c.integration) : null;
    const isOauth = c.auth === 'oauth' && OAUTH_IDS.has(c.id);
    const rd = isOauth ? oauthReadiness(c.id) : { ready: null, missing: [] };
    const isMessaging = c.id === 'meta-messaging' || c.id === 'instagram-inbox';
    const view = isMessaging ? messagingView(storeId, c.channel_types) : publicView(integ);
    const schema = c.auth === 'token' ? Credentials.publicSchema(c.id) : null;
    const expired = integ?.status === 'needs_reauth' || (view?.expires_at && new Date(view.expires_at).getTime() < Date.now());
    const redirect =
      !isOauth ? null : c.id === 'shopify' ? `${backendUrl()}/api/shopify/callback` : isMessaging ? `${backendUrl()}/api/support-channels/meta/callback` : redirectUriFor(c.id);
    const waReady = c.embedded ? WA_ENV.every((k) => process.env[k]) : null;
    return {
      ...c,
      oauth_ready: isOauth ? rd.ready : null,
      embedded_ready: c.embedded ? !!waReady : null,
      operator,
      missing_env: operator ? (c.embedded && !waReady ? WA_ENV.filter((k) => !process.env[k]) : rd.missing) : [],
      docs: operator ? PROVIDERS[c.id]?.docs || null : null,
      redirect_uri: operator ? redirect : null,
      credentials: schema,
      access: ACCESS[c.id] || [],
      connection: view,
      needs_reauth: !!expired,
      configured: isMessaging ? !!view : c.configured && !expired,
      hint: c.id === 'instagram-inbox' && !view && messagingView(storeId, ['facebook'])
        ? 'Your Facebook Page is connected, but no Instagram professional account is linked to it. In Instagram: Settings, then Account type and tools, then switch to a Professional account. In Facebook: your Page, Settings, Linked accounts, Instagram. Then reconnect here.'
        : null,
    };
  });
}

// ── WhatsApp Embedded Signup (Meta's popup flow: no token to paste) ──────────

function embeddedConfig() {
  const missing = WA_ENV.filter((k) => !process.env[k]);
  if (missing.length) return { ready: false };
  return { ready: true, appId: process.env.META_APP_ID, configId: process.env.META_WA_CONFIG_ID, version: process.env.META_GRAPH_VERSION || 'v20.0' };
}

/**
 * Called after the browser finished Meta's Embedded Signup. `code` is exchanged for a business token,
 * the WhatsApp Business Account is subscribed to our webhook, and the number is stored for the AI agent.
 */
async function connectWhatsAppEmbedded(storeId, userId, { code, phone_number_id: phoneNumberId, waba_id: wabaId }) {
  const cfg = embeddedConfig();
  if (!cfg.ready) throw new Error('WhatsApp sign-in is not available yet.');
  if (!code || !phoneNumberId || !wabaId) throw new Error('WhatsApp signup did not return the number details. Please try again.');
  const axios = require('axios');
  const G = `https://graph.facebook.com/${cfg.version}`;
  let token;
  try {
    const t = await axios.get(`${G}/oauth/access_token`, { params: { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, code }, timeout: 20000 });
    token = t.data.access_token;
    if (!token) throw new Error('No access token returned.');
    await axios.post(`${G}/${wabaId}/subscribed_apps`, null, { params: { access_token: token }, timeout: 20000 });
  } catch (err) {
    throw new Error(`WhatsApp connection failed: ${errMsg(err)}`);
  }

  let display = {};
  try {
    const info = await axios.get(`${G}/${phoneNumberId}`, { params: { fields: 'display_phone_number,verified_name', access_token: token }, timeout: 15000 });
    display = { display_phone: info.data.display_phone_number, verified_name: info.data.verified_name };
  } catch (_) {
    /* cosmetic only */
  }

  await IntegrationsService.saveIntegration(storeId, userId, 'whatsapp-business', {
    phoneNumberId: String(phoneNumberId),
    wabaId: String(wabaId),
    permanentToken: token,
    connected_via: 'embedded-signup',
    verification: 'live',
    ...display,
  });
  return { phone: display.display_phone || null, name: display.verified_name || null };
}

// ── Popup result page ────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Tiny page shown inside the OAuth popup: tells the opener the result, then closes itself. */
function popupPage({ ok, provider, message }) {
  const payload = JSON.stringify({ type: 'oauth-result', ok, provider, message: message || '' }).replace(/</g, '\\u003c');
  const origin = JSON.stringify(frontendUrl());
  return `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? 'Connected' : 'Connection failed'}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0f19;color:#f1f5f9;text-align:center;padding:24px}
.c{max-width:360px}h1{font-size:20px;margin:0 0 8px}p{opacity:.75;font-size:14px;margin:0 0 16px}button{background:#6366f1;color:#fff;border:0;border-radius:10px;padding:9px 18px;font-size:14px;cursor:pointer}</style></head>
<body><div class="c"><h1>${ok ? 'Connected' : 'Connection failed'}</h1><p>${esc(message || (ok ? 'You can close this window.' : 'Please close this window and try again.'))}</p>
<button onclick="window.close()">Close window</button></div>
<script>try{if(window.opener){window.opener.postMessage(${payload},${origin});}}catch(e){}${ok ? 'setTimeout(function(){window.close()},900);' : ''}</script></body></html>`;
}

module.exports = {
  start,
  handleCallback,
  setSelectedAccounts,
  saveCredentials,
  embeddedConfig,
  connectWhatsAppEmbedded,
  disconnect,
  getValidAccessToken,
  catalog,
  popupPage,
  verifyState,
  signState,
  getIntegration,
};

const axios = require('axios');

/**
 * OAuth provider specs. Each one knows how to build the consent URL, swap the returned code for
 * tokens, refresh them, and list the ad accounts the user granted access to.
 *
 * Credentials come from environment variables (one developer app per platform, owned by YOU, the
 * SaaS operator; your customers only ever click "Connect"). A provider is "ready" when all of its
 * envVars are set.
 */

const META_V = process.env.META_GRAPH_VERSION || 'v20.0';
const GOOGLE_ADS_V = process.env.GOOGLE_ADS_API_VERSION || 'v20';

const env = (k) => process.env[k] || '';
const http = (cfg) => axios({ timeout: 20000, ...cfg });

const errMsg = (err) =>
  err.response?.data?.error?.message ||
  err.response?.data?.error_description ||
  err.response?.data?.message ||
  (typeof err.response?.data?.error === 'string' ? err.response.data.error : '') ||
  err.message;

const expiresAt = (secs) => (secs ? new Date(Date.now() + Number(secs) * 1000).toISOString() : null);

const PROVIDERS = {
  'meta-ads': {
    label: 'Meta Ads',
    envVars: ['META_APP_ID', 'META_APP_SECRET'],
    docs: 'https://developers.facebook.com/apps/',
    codeParam: 'code',
    authorizeUrl({ redirectUri, state }) {
      const scope = 'ads_read,business_management';
      return `https://www.facebook.com/${META_V}/dialog/oauth?client_id=${env('META_APP_ID')}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${scope}&response_type=code`;
    },
    async exchange({ code, redirectUri }) {
      const short = await http({
        url: `https://graph.facebook.com/${META_V}/oauth/access_token`,
        params: { client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), redirect_uri: redirectUri, code },
      });
      // Swap the 1-hour token for a ~60-day one so scheduled syncs keep working.
      const long = await http({
        url: `https://graph.facebook.com/${META_V}/oauth/access_token`,
        params: { grant_type: 'fb_exchange_token', client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), fb_exchange_token: short.data.access_token },
      });
      return { accessToken: long.data.access_token, expiresAt: expiresAt(long.data.expires_in || 5184000) };
    },
    async identity(t) {
      const r = await http({ url: `https://graph.facebook.com/${META_V}/me`, params: { fields: 'name', access_token: t.accessToken } });
      return r.data?.name || '';
    },
    async listAccounts(t) {
      const out = [];
      let url = `https://graph.facebook.com/${META_V}/me/adaccounts`;
      let params = { fields: 'account_id,name,account_status,currency', limit: 100, access_token: t.accessToken };
      for (let i = 0; i < 10; i++) {
        const r = await http({ url, params });
        for (const a of r.data?.data || []) {
          out.push({ id: `act_${a.account_id}`, name: a.name || `act_${a.account_id}`, currency: a.currency, active: a.account_status === 1 });
        }
        if (!r.data?.paging?.next) break;
        url = r.data.paging.next;
        params = undefined;
      }
      return out;
    },
  },

  'google-ads': {
    label: 'Google Ads',
    envVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN'],
    docs: 'https://console.cloud.google.com/apis/credentials',
    callback: 'google', // one redirect URI covers every Google product
    codeParam: 'code',
    authorizeUrl({ redirectUri, state }) {
      const q = new URLSearchParams({
        client_id: env('GOOGLE_CLIENT_ID'),
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/adwords',
        access_type: 'offline', // we need a refresh token: access tokens last one hour
        prompt: 'consent',
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async exchange({ code, redirectUri }) {
      const r = await http({
        method: 'post',
        url: 'https://oauth2.googleapis.com/token',
        data: new URLSearchParams({ code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      });
      return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token, expiresAt: expiresAt(r.data.expires_in) };
    },
    async refresh(t) {
      const r = await http({
        method: 'post',
        url: 'https://oauth2.googleapis.com/token',
        data: new URLSearchParams({ refresh_token: t.refreshToken, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), grant_type: 'refresh_token' }),
      });
      return { accessToken: r.data.access_token, expiresAt: expiresAt(r.data.expires_in) };
    },
    async listAccounts(t) {
      const r = await http({
        url: `https://googleads.googleapis.com/${GOOGLE_ADS_V}/customers:listAccessibleCustomers`,
        headers: { Authorization: `Bearer ${t.accessToken}`, 'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN') },
      });
      return (r.data?.resourceNames || []).map((n) => {
        const id = String(n).replace('customers/', '');
        return { id, name: `Account ${id}` };
      });
    },
  },

  'tiktok-ads': {
    label: 'TikTok Ads',
    envVars: ['TIKTOK_APP_ID', 'TIKTOK_APP_SECRET'],
    docs: 'https://business-api.tiktok.com/portal/apps',
    codeParam: 'auth_code', // TikTok returns auth_code, not code
    authorizeUrl({ redirectUri, state }) {
      return `https://business-api.tiktok.com/portal/auth?app_id=${env('TIKTOK_APP_ID')}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    },
    async exchange({ code }) {
      const r = await http({
        method: 'post',
        url: 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
        data: { app_id: env('TIKTOK_APP_ID'), secret: env('TIKTOK_APP_SECRET'), auth_code: code },
      });
      if (r.data?.code !== 0) throw new Error(r.data?.message || 'TikTok token exchange failed.');
      return { accessToken: r.data.data.access_token, extra: { advertiser_ids: r.data.data.advertiser_ids || [] } };
    },
    async listAccounts(t) {
      const ids = t.extra?.advertiser_ids || [];
      if (!ids.length) return [];
      const r = await http({
        url: 'https://business-api.tiktok.com/open_api/v1.3/advertiser/info/',
        headers: { 'Access-Token': t.accessToken },
        params: { advertiser_ids: JSON.stringify(ids), fields: JSON.stringify(['advertiser_id', 'name', 'currency']) },
      });
      const list = r.data?.data?.list || [];
      return ids.map((id) => {
        const hit = list.find((x) => String(x.advertiser_id) === String(id));
        return { id: String(id), name: hit?.name || `Advertiser ${id}`, currency: hit?.currency };
      });
    },
  },

  'snapchat-ads': {
    label: 'Snapchat Ads',
    envVars: ['SNAPCHAT_CLIENT_ID', 'SNAPCHAT_CLIENT_SECRET'],
    docs: 'https://business.snapchat.com/',
    codeParam: 'code',
    authorizeUrl({ redirectUri, state }) {
      const q = new URLSearchParams({ client_id: env('SNAPCHAT_CLIENT_ID'), redirect_uri: redirectUri, response_type: 'code', scope: 'snapchat-marketing-api', state });
      return `https://accounts.snapchat.com/login/oauth2/authorize?${q}`;
    },
    async exchange({ code, redirectUri }) {
      const r = await http({
        method: 'post',
        url: 'https://accounts.snapchat.com/login/oauth2/access_token',
        data: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: env('SNAPCHAT_CLIENT_ID'), client_secret: env('SNAPCHAT_CLIENT_SECRET'), redirect_uri: redirectUri }),
      });
      return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token, expiresAt: expiresAt(r.data.expires_in) };
    },
    async refresh(t) {
      const r = await http({
        method: 'post',
        url: 'https://accounts.snapchat.com/login/oauth2/access_token',
        data: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: env('SNAPCHAT_CLIENT_ID'), client_secret: env('SNAPCHAT_CLIENT_SECRET') }),
      });
      return { accessToken: r.data.access_token, expiresAt: expiresAt(r.data.expires_in) };
    },
    async listAccounts(t) {
      const r = await http({ url: 'https://adsapi.snapchat.com/v1/me/organizations', params: { with_ad_accounts: true }, headers: { Authorization: `Bearer ${t.accessToken}` } });
      const out = [];
      for (const o of r.data?.organizations || []) {
        for (const a of o.organization?.ad_accounts || []) out.push({ id: a.id, name: a.name || a.id, currency: a.currency });
      }
      return out;
    },
  },

  'pinterest-ads': {
    label: 'Pinterest Ads',
    envVars: ['PINTEREST_APP_ID', 'PINTEREST_APP_SECRET'],
    docs: 'https://developers.pinterest.com/apps/',
    codeParam: 'code',
    authorizeUrl({ redirectUri, state }) {
      const q = new URLSearchParams({ client_id: env('PINTEREST_APP_ID'), redirect_uri: redirectUri, response_type: 'code', scope: 'ads:read,user_accounts:read', state });
      return `https://www.pinterest.com/oauth/?${q}`;
    },
    async exchange({ code, redirectUri }) {
      const basic = Buffer.from(`${env('PINTEREST_APP_ID')}:${env('PINTEREST_APP_SECRET')}`).toString('base64');
      const r = await http({
        method: 'post',
        url: 'https://api.pinterest.com/v5/oauth/token',
        headers: { Authorization: `Basic ${basic}` },
        data: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      });
      return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token, expiresAt: expiresAt(r.data.expires_in) };
    },
    async refresh(t) {
      const basic = Buffer.from(`${env('PINTEREST_APP_ID')}:${env('PINTEREST_APP_SECRET')}`).toString('base64');
      const r = await http({
        method: 'post',
        url: 'https://api.pinterest.com/v5/oauth/token',
        headers: { Authorization: `Basic ${basic}` },
        data: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }),
      });
      return { accessToken: r.data.access_token, expiresAt: expiresAt(r.data.expires_in) };
    },
    async listAccounts(t) {
      const r = await http({ url: 'https://api.pinterest.com/v5/ad_accounts', headers: { Authorization: `Bearer ${t.accessToken}` } });
      return (r.data?.items || []).map((a) => ({ id: a.id, name: a.name || a.id, currency: a.currency }));
    },
  },
};

// Google Analytics 4 and Search Console reuse Google's OAuth client; only the scope and the account list differ.
const googleBase = (scope) => ({
  envVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  docs: 'https://console.cloud.google.com/apis/credentials',
  callback: 'google',
  codeParam: 'code',
  authorizeUrl({ redirectUri, state }) {
    const q = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri, response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  async exchange({ code, redirectUri }) {
    const r = await http({
      method: 'post',
      url: 'https://oauth2.googleapis.com/token',
      data: new URLSearchParams({ code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token, expiresAt: expiresAt(r.data.expires_in) };
  },
  async refresh(t) {
    const r = await http({
      method: 'post',
      url: 'https://oauth2.googleapis.com/token',
      data: new URLSearchParams({ refresh_token: t.refreshToken, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), grant_type: 'refresh_token' }),
    });
    return { accessToken: r.data.access_token, expiresAt: expiresAt(r.data.expires_in) };
  },
});

PROVIDERS['ga4'] = {
  ...googleBase('https://www.googleapis.com/auth/analytics.readonly'),
  label: 'Google Analytics 4',
  async listAccounts(t) {
    const r = await http({ url: 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries', params: { pageSize: 200 }, headers: { Authorization: `Bearer ${t.accessToken}` } });
    const out = [];
    for (const acc of r.data?.accountSummaries || []) {
      for (const prop of acc.propertySummaries || []) {
        out.push({ id: prop.property, name: `${acc.displayName || 'Account'} / ${prop.displayName || prop.property}` });
      }
    }
    return out;
  },
};

PROVIDERS['gsc'] = {
  ...googleBase('https://www.googleapis.com/auth/webmasters.readonly'),
  label: 'Google Search Console',
  async listAccounts(t) {
    const r = await http({ url: 'https://www.googleapis.com/webmasters/v3/sites', headers: { Authorization: `Bearer ${t.accessToken}` } });
    return (r.data?.siteEntry || []).map((s) => ({ id: s.siteUrl, name: s.siteUrl }));
  },
};

// Microsoft Advertising (Bing Ads): sign-in works; listing ad accounts needs the SOAP Customer Management API, not built yet.
PROVIDERS['bing-ads'] = {
  label: 'Microsoft Advertising',
  envVars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
  docs: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  codeParam: 'code',
  authorizeUrl({ redirectUri, state }) {
    const q = new URLSearchParams({ client_id: env('MICROSOFT_CLIENT_ID'), response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: 'https://ads.microsoft.com/msads.manage offline_access', state });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${q}`;
  },
  async exchange({ code, redirectUri }) {
    const r = await http({
      method: 'post',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      data: new URLSearchParams({ client_id: env('MICROSOFT_CLIENT_ID'), client_secret: env('MICROSOFT_CLIENT_SECRET'), code, redirect_uri: redirectUri, grant_type: 'authorization_code', scope: 'https://ads.microsoft.com/msads.manage offline_access' }),
    });
    return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token, expiresAt: expiresAt(r.data.expires_in) };
  },
  async refresh(t) {
    const r = await http({
      method: 'post',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      data: new URLSearchParams({ client_id: env('MICROSOFT_CLIENT_ID'), client_secret: env('MICROSOFT_CLIENT_SECRET'), refresh_token: t.refreshToken, grant_type: 'refresh_token', scope: 'https://ads.microsoft.com/msads.manage offline_access' }),
    });
    return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token, expiresAt: expiresAt(r.data.expires_in) };
  },
  async listAccounts() {
    return [];
  },
};

// Klaviyo requires PKCE: the server keeps the verifier (sealed inside the signed state) and sends only the challenge.
const sha256b64url = (v) => require('crypto').createHash('sha256').update(v).digest('base64url');
PROVIDERS['klaviyo'] = {
  label: 'Klaviyo',
  envVars: ['KLAVIYO_CLIENT_ID', 'KLAVIYO_CLIENT_SECRET'],
  docs: 'https://www.klaviyo.com/oauth/client',
  codeParam: 'code',
  pkce: true,
  authorizeUrl({ redirectUri, state, codeVerifier }) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: env('KLAVIYO_CLIENT_ID'),
      redirect_uri: redirectUri,
      scope: 'accounts:read lists:read lists:write profiles:read profiles:write',
      state,
      code_challenge_method: 'S256',
      code_challenge: sha256b64url(codeVerifier),
    });
    return `https://www.klaviyo.com/oauth/authorize?${q}`;
  },
  async exchange({ code, redirectUri, codeVerifier }) {
    const basic = Buffer.from(`${env('KLAVIYO_CLIENT_ID')}:${env('KLAVIYO_CLIENT_SECRET')}`).toString('base64');
    const r = await http({
      method: 'post',
      url: 'https://a.klaviyo.com/oauth/token',
      headers: { Authorization: `Basic ${basic}` },
      data: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
    });
    return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token, expiresAt: expiresAt(r.data.expires_in) };
  },
  async refresh(t) {
    const basic = Buffer.from(`${env('KLAVIYO_CLIENT_ID')}:${env('KLAVIYO_CLIENT_SECRET')}`).toString('base64');
    const r = await http({
      method: 'post',
      url: 'https://a.klaviyo.com/oauth/token',
      headers: { Authorization: `Basic ${basic}` },
      data: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }),
    });
    return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token || t.refreshToken, expiresAt: expiresAt(r.data.expires_in) };
  },
  async identity(t) {
    const r = await http({ url: 'https://a.klaviyo.com/api/accounts/', headers: { Authorization: `Bearer ${t.accessToken}`, revision: '2024-10-15', accept: 'application/json' } });
    return r.data?.data?.[0]?.attributes?.contact_information?.organization_name || '';
  },
  async listAccounts() {
    return [];
  },
};

function readiness(id) {
  const p = PROVIDERS[id];
  if (!p) return { ready: false, missing: [] };
  const missing = p.envVars.filter((k) => !process.env[k]);
  return { ready: missing.length === 0, missing };
}

module.exports = { PROVIDERS, readiness, errMsg };

/**
 * API-key style connectors: couriers and WhatsApp Cloud API. These services do not offer OAuth,
 * the merchant gets credentials from the provider and pastes them here.
 *
 * `verify: 'live'`  -> credentials are checked against the provider by IntegrationsService before saving.
 * `verify: 'none'`  -> we have no verified public endpoint for this provider yet; the credentials are
 *                      stored encrypted and the UI says plainly that they were not live-verified.
 */

const f = (id, label, opts = {}) => ({ id, label, secret: false, required: true, type: 'text', placeholder: '', help: '', ...opts });
const secret = (id, label, opts = {}) => f(id, label, { secret: true, type: 'password', ...opts });

const generic = (name) => [
  secret('apiKey', 'API key / token', { help: `Ask your ${name} account manager for API access.` }),
  f('accountNumber', 'Account / client number', { required: false, help: 'Your merchant or account ID with the courier, if they issued one.' }),
];

const guide = (name) => [`Contact ${name} (or open their merchant portal) and request API access for your account.`, 'Copy the credentials they give you.', 'Paste them below.'];

const SCHEMAS = {
  // ── Verified against the provider's API ──
  'postex-courier': { name: 'PostEx', verify: 'live', guide: ['Log in to the PostEx merchant portal.', 'Open API settings and generate an API token.', 'Paste the token below.'], fields: [secret('apiToken', 'API token')] },
  'trax-logistics': { name: 'Trax', verify: 'live', guide: ['Log in to Trax Sonic.', 'Open Settings, API and copy your API key.'], fields: [secret('apiKey', 'API key')] },
  'tcs-courier': {
    name: 'TCS',
    verify: 'live',
    guide: ['Ask TCS for CN API access on your account.', 'Use the username, password and account number they issue.'],
    fields: [f('userName', 'User name'), secret('password', 'Password'), f('accountNumber', 'Account number')],
  },
  'call-courier': {
    name: 'Call Courier',
    verify: 'live',
    guide: ['Request COD API access from Call Courier.', 'Copy your merchant ID and secret key.'],
    fields: [f('merchantId', 'Merchant ID'), secret('secretKey', 'Secret key')],
  },
  'rider-courier': { name: 'Rider', verify: 'live', guide: ['Open your Rider merchant dashboard.', 'Generate an API token under Developer settings.'], fields: [secret('apiToken', 'API token')] },
  'whatsapp-business': {
    name: 'WhatsApp Business',
    verify: 'live',
    guide: ['In Meta Business, open your WhatsApp Business app.', 'Copy the Phone Number ID.', 'Create a permanent System User token with whatsapp_business_messaging permission.'],
    fields: [f('phoneNumberId', 'Phone number ID'), secret('permanentToken', 'Permanent access token')],
  },
  // ── Accepted but not verifiable by this server yet ──
  'leopards-courier': { name: 'Leopards', verify: 'none', guide: guide('Leopards'), fields: [secret('apiKey', 'API key'), secret('apiPassword', 'API password')] },
  'mnp-courier': {
    name: 'M&P',
    verify: 'none',
    guide: guide('M&P (Muller & Phipps)'),
    fields: [f('userName', 'User name'), secret('password', 'Password'), secret('apiKey', 'API key', { required: false })],
  },
  'bluex-courier': {
    name: 'BlueEx',
    verify: 'none',
    guide: guide('BlueEx'),
    fields: [f('userName', 'User name'), secret('password', 'Password'), f('accountNumber', 'Account number')],
  },
  'daewoo-courier': { name: 'Daewoo FastEx', verify: 'none', guide: guide('Daewoo FastEx'), fields: generic('Daewoo FastEx') },
  'stallion-courier': { name: 'Stallion', verify: 'none', guide: guide('Stallion'), fields: generic('Stallion') },
  'tranzo-courier': { name: 'Tranzo', verify: 'none', guide: guide('Tranzo'), fields: generic('Tranzo') },
  'kangaroo-courier': { name: 'Kangaroo', verify: 'none', guide: guide('Kangaroo'), fields: generic('Kangaroo') },
  'pakpost-courier': {
    name: 'Pakistan Post',
    verify: 'none',
    guide: guide('Pakistan Post'),
    fields: [f('userName', 'User name'), secret('password', 'Password'), f('accountNumber', 'Customer / account number', { required: false })],
  },
  'speedaf-courier': { name: 'Speedaf', verify: 'none', guide: guide('Speedaf'), fields: generic('Speedaf') },
  'bykea-courier': { name: 'Bykea', verify: 'none', guide: guide('Bykea'), fields: generic('Bykea') },
  'dhl-courier': {
    name: 'DHL Express',
    verify: 'none',
    guide: ['Create a DHL Express developer account and an app with MyDHL API access.', 'Copy the API key, API secret and your DHL account number.'],
    fields: [secret('apiKey', 'API key'), secret('apiSecret', 'API secret'), f('accountNumber', 'DHL account number')],
  },
  'fedex-courier': {
    name: 'FedEx',
    verify: 'none',
    guide: ['Create a project in the FedEx Developer Portal.', 'Copy the client ID, client secret and your FedEx account number.'],
    fields: [f('clientId', 'Client ID'), secret('clientSecret', 'Client secret'), f('accountNumber', 'FedEx account number')],
  },
};

/** Fields as the browser sees them: no values, only what to ask for. */
function publicSchema(id) {
  const s = SCHEMAS[id];
  if (!s) return null;
  return { verify: s.verify, guide: s.guide, fields: s.fields.map(({ id: fid, label, secret: isSecret, required, type, placeholder, help }) => ({ id: fid, label, secret: isSecret, required, type, placeholder, help })) };
}

/** Keep only schema-known string fields; reject missing required ones. */
function cleanFields(id, raw) {
  const s = SCHEMAS[id];
  if (!s) throw new Error('This connector does not take API credentials.');
  const out = {};
  for (const fld of s.fields) {
    const v = String(raw?.[fld.id] ?? '').trim();
    if (!v && fld.required) throw new Error(`${fld.label} is required.`);
    if (v) out[fld.id] = v.slice(0, 500);
  }
  return out;
}

module.exports = { SCHEMAS, publicSchema, cleanFields };

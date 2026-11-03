const U = require('./util');

/**
 * Connector catalog. `status`: 'native' = works in this app today, 'import' = supported through
 * CSV / manual import, 'planned' = listed so users can request it. Nothing marked native is a stub.
 */
const CATALOG = [
  // Sales channels
  { id: 'shopify', name: 'Shopify', category: 'Sales Channels', description: 'Orders, customers and catalog', support: 'native', auth: 'oauth', integration: 'shopify' },
  { id: 'amazon-seller', name: 'Amazon Seller Central', category: 'Sales Channels', description: 'Marketplace orders', support: 'planned', auth: 'planned' },
  { id: 'recharge', name: 'Recharge', category: 'Sales Channels', description: 'Subscriptions and recurring billing', support: 'planned', auth: 'planned' },
  // Analytics & attribution
  { id: 'store-pixel', name: 'First-party Pixel', category: 'Analytics and Attribution', description: 'Session, funnel and multi-touch attribution from your storefront', support: 'native', auth: 'pixel', pixel: true },
  { id: 'ga4', name: 'Google Analytics 4', category: 'Analytics and Attribution', description: 'Website analytics properties', support: 'native', auth: 'oauth', integration: 'ga4', note: 'Connected and stored securely. Reports that read from Google Analytics are not built yet, so nothing is imported from it today.' },
  { id: 'gsc', name: 'Google Search Console', category: 'Analytics and Attribution', description: 'Organic search performance', support: 'native', auth: 'oauth', integration: 'gsc', note: 'Connected and stored securely. Search reports are not built yet, so nothing is imported from it today.' },
  // Advertising
  { id: 'meta-ads', name: 'Facebook / Instagram Ads', category: 'Advertising', description: 'Daily campaign spend, clicks and purchases', support: 'native', auth: 'oauth', integration: 'meta-ads', sync: 'meta', sync_supported: true },
  { id: 'google-ads', name: 'Google Ads', category: 'Advertising', description: 'Spend and conversions', support: 'import', auth: 'oauth', integration: 'google-ads', platform: 'google-ads', sync_supported: false, note: 'Connected. Automatic spend sync for Google Ads is not built yet: import its spend as a CSV in Marketing, Connect data, to see it in your reports.' },
  { id: 'tiktok-ads', name: 'TikTok Ads', category: 'Advertising', description: 'Spend and conversions', support: 'import', auth: 'oauth', integration: 'tiktok-ads', platform: 'tiktok-ads', sync_supported: false, note: 'Connected. Automatic spend sync for TikTok Ads is not built yet: import its spend as a CSV in Marketing, Connect data.' },
  { id: 'snapchat-ads', name: 'Snapchat Ads', category: 'Advertising', description: 'Spend and conversions', support: 'import', auth: 'oauth', integration: 'snapchat-ads', platform: 'snapchat-ads', sync_supported: false, note: 'Connected. Automatic spend sync for Snapchat Ads is not built yet: import its spend as a CSV in Marketing, Connect data.' },
  { id: 'pinterest-ads', name: 'Pinterest Ads', category: 'Advertising', description: 'Spend and conversions', support: 'import', auth: 'oauth', integration: 'pinterest-ads', platform: 'pinterest-ads', sync_supported: false, note: 'Connected. Automatic spend sync for Pinterest Ads is not built yet: import its spend as a CSV in Marketing, Connect data.' },
  { id: 'bing-ads', name: 'Microsoft (Bing) Ads', category: 'Advertising', description: 'Spend and conversions', support: 'import', auth: 'oauth', integration: 'bing-ads', platform: 'bing-ads', sync_supported: false, note: 'Signed in. Listing ad accounts and spend sync for Microsoft Ads are not built yet: import its spend as a CSV in Marketing, Connect data.' },
  { id: 'twitter-ads', name: 'X (Twitter) Ads', category: 'Advertising', description: 'Spend and conversions', support: 'import', auth: 'import', platform: 'twitter-ads' },
  // Marketing
  { id: 'klaviyo', name: 'Klaviyo', category: 'Marketing', description: 'Push audiences into Klaviyo lists', support: 'native', auth: 'oauth', integration: 'klaviyo', klaviyo: true, note: 'Connected. Send audiences to Klaviyo lists from Marketing, Activate.' },
  { id: 'meta-capi', name: 'Meta Conversions API', category: 'Marketing', description: 'Send purchases server-side to improve match quality', support: 'native', auth: 'key', capi: true },
  // Messaging & inbox
  { id: 'meta-messaging', name: 'Facebook Messenger & Comments', category: 'Messaging', description: 'Messenger chats and comments on your Page posts and ads', support: 'native', auth: 'oauth', link_to: '/dashboard/channels', channel_types: ['facebook'], note: 'Choose how AI replies to Facebook in AI Settings.' },
  { id: 'instagram-inbox', name: 'Instagram Messages & Comments', category: 'Messaging', description: 'Instagram DMs, post and reel comments, story replies', support: 'native', auth: 'oauth', link_to: '/dashboard/channels', channel_types: ['instagram'], note: 'Choose how AI replies to Instagram in AI Settings.' },
  { id: 'email-inbox', name: 'Support Email', category: 'Messaging', description: 'A shared support@ inbox', support: 'native', auth: 'link', link_to: '/dashboard/channels', channel_types: ['email'] },
  { id: 'whatsapp-business', name: 'WhatsApp Business', category: 'Messaging', description: 'Conversational orders via the Cloud API', support: 'native', auth: 'token', integration: 'whatsapp-business', embedded: true },
  // Couriers (Pakistan COD and international). They only issue API keys: there is no OAuth for any of them.
  { id: 'postex-courier', name: 'PostEx', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'postex-courier' },
  { id: 'trax-logistics', name: 'Trax', category: 'Couriers (COD)', description: 'COD shipments (Sonic)', support: 'native', auth: 'token', integration: 'trax-logistics' },
  { id: 'leopards-courier', name: 'Leopards', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'leopards-courier' },
  { id: 'tcs-courier', name: 'TCS', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'tcs-courier' },
  { id: 'call-courier', name: 'Call Courier', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'call-courier' },
  { id: 'mnp-courier', name: 'M&P', category: 'Couriers (COD)', description: 'Muller & Phipps COD shipments', support: 'native', auth: 'token', integration: 'mnp-courier' },
  { id: 'rider-courier', name: 'Rider', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'rider-courier' },
  { id: 'bluex-courier', name: 'BlueEx', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'bluex-courier' },
  { id: 'daewoo-courier', name: 'Daewoo FastEx', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'daewoo-courier' },
  { id: 'stallion-courier', name: 'Stallion', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'stallion-courier' },
  { id: 'tranzo-courier', name: 'Tranzo', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'tranzo-courier' },
  { id: 'kangaroo-courier', name: 'Kangaroo', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'kangaroo-courier' },
  { id: 'speedaf-courier', name: 'Speedaf', category: 'Couriers (COD)', description: 'COD shipments', support: 'native', auth: 'token', integration: 'speedaf-courier' },
  { id: 'bykea-courier', name: 'Bykea', category: 'Couriers (COD)', description: 'Same-day bike delivery', support: 'native', auth: 'token', integration: 'bykea-courier' },
  { id: 'pakpost-courier', name: 'Pakistan Post', category: 'Couriers (COD)', description: 'Postal and COD parcels', support: 'native', auth: 'token', integration: 'pakpost-courier' },
  { id: 'dhl-courier', name: 'DHL Express', category: 'Couriers (COD)', description: 'International express', support: 'native', auth: 'token', integration: 'dhl-courier' },
  { id: 'fedex-courier', name: 'FedEx', category: 'Couriers (COD)', description: 'International express', support: 'native', auth: 'token', integration: 'fedex-courier' },
];

function catalog(storeId) {
  const data = U.db();
  const integrations = data.integrations.filter((i) => i.store_id === storeId);
  const store = data.stores.find((s) => s.id === storeId);
  const spendPlatforms = new Set(data.ad_spend_daily.filter((r) => r.store_id === storeId).map((r) => r.platform));
  const hasPixel = data.pixel_events.some((e) => e.store_id === storeId);

  return CATALOG.map((c) => {
    let configured = false;
    if (c.integration) configured = integrations.some((i) => i.provider === c.integration && i.status === 'connected');
    if (c.platform && spendPlatforms.has(c.platform)) configured = true;
    if (c.pixel) configured = hasPixel;
    if (c.klaviyo) configured = configured || !!store?.settings?.klaviyo?.api_key_encrypted;
    if (c.capi) configured = !!store?.settings?.capi?.access_token_encrypted;
    if (c.channel_types) configured = (data.support_channels || []).some((ch) => ch.store_id === storeId && c.channel_types.includes(ch.channel_type) && ch.status === 'connected');
    return { ...c, configured };
  });
}

module.exports = { catalog };

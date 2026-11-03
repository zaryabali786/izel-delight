/** Display formatting shared by the marketing tabs. Null means "not computable", shown as an en dash. */
export const DASH = '–';

export function money(v: number | null | undefined, cur = '', dp = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${cur}${(v / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e5) return `${cur}${(v / 1e3).toFixed(0)}K`;
  return `${cur}${v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 })}`;
}

export function num(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return v.toLocaleString(undefined, { maximumFractionDigits: dp });
}

export function ratio(v: number | null | undefined): string {
  return v === null || v === undefined ? DASH : `${v.toFixed(2)}x`;
}

export function pct(v: number | null | undefined, dp = 1): string {
  return v === null || v === undefined ? DASH : `${v.toFixed(dp)}%`;
}

export function channelLabel(id: string): string {
  const map: Record<string, string> = {
    'meta-ads': 'Meta Ads',
    'google-ads': 'Google Ads',
    'tiktok-ads': 'TikTok Ads',
    'snapchat-ads': 'Snapchat Ads',
    'pinterest-ads': 'Pinterest Ads',
    'twitter-ads': 'X Ads',
    'bing-ads': 'Bing Ads',
    'search-organic': 'Organic search',
    'social-organic': 'Organic social',
    'other-paid': 'Other paid',
    direct: 'Direct',
    email: 'Email',
    whatsapp: 'WhatsApp',
    referral: 'Referral',
    other: 'Other'
  };
  return map[id] || id;
}

/** Stable palette slot per channel so a channel keeps its colour across charts and filters. */
export function channelSlot(id: string): number {
  const slots: Record<string, number> = { 'meta-ads': 1, 'google-ads': 2, 'tiktok-ads': 3, email: 4, whatsapp: 5, 'snapchat-ads': 7, direct: 8 };
  return slots[id] || 6;
}

export interface Store {
  id: string;
  user_id: string;
  name: string;
  domain: string;
  platform: 'Shopify' | 'WooCommerce' | 'Custom' | 'Daraz';
  currency: 'PKR' | 'USD';
  currency_symbol: string;
  logo_url?: string;
  status: 'active' | 'trial' | 'connected';
  settings?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface CreateStoreDto {
  name: string;
  domain?: string;
  platform?: 'Shopify' | 'WooCommerce' | 'Custom' | 'Daraz';
  currency?: 'PKR' | 'USD';
}

export interface StoreIntegration {
  id: string;
  store_id: string;
  user_id: string;
  provider: string;
  status: 'connected' | 'disconnected' | 'syncing' | 'error';
  config: Record<string, any>;
  last_synced_at?: string;
}

export interface StoreProduct {
  id: string;
  store_id: string;
  title: string;
  sku: string;
  price: number;
  compare_at_price?: number;
  stock: number;
  vendor?: string;
  category?: string;
  status: 'active' | 'draft' | 'archived';
  image_url?: string;
  returns_rate?: number;
  rto_risk?: 'Low' | 'Medium' | 'High';
  created_at?: string;
}

export interface StoreMetrics {
  id: string;
  store_id: string;
  gross_revenue: number;
  net_sales: number;
  rto_loss: number;
  cogs: number;
  ad_spend: number;
  courier_fees: number;
  net_profit: number;
  net_margin_pct: number;
  total_orders: number;
  aov: number;
  channel_data?: any[];
}

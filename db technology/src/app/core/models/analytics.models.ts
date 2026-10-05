export interface IntegrationItem {
  id: string;
  name: string;
  category: string;
  type: 'storefront' | 'ads' | 'courier' | 'messaging';
  status: 'connected' | 'syncing' | 'not_connected';
  statusLabel: string;
  primaryInfo: string;
  secondaryInfo: string;
  tagline?: string;
  lastSync?: string;
  metrics: { label: string; value: string }[];
  isPulsing?: boolean;
}

export interface ProductAnalytics {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  unitsSold: number;
  grossRevenue: number;
  adSpend: number;
  cogs: number;
  netProfit: number;
  netMargin: number;
  roas: number;
  ncRoas: number;
  stockLeft: number;
  daysOfStock: number;
  rtoRate: number;
  rtoStatus: 'Low' | 'Moderate' | 'High Risk';
  growthRate: number;
  image: string;
}

export interface CityCourierMetric {
  city: string;
  zone: string;
  orders: number;
  delivered: number;
  successRate: number;
  rtoRate: number;
  topCourier: string;
  avgTransitHours: number;
  riskStatus: 'Safe' | 'Watch' | 'High Risk';
}

export interface ChannelAttribution {
  channel: string;
  icon: string;
  iconBg: string;
  spend: number;
  revenue: number;
  blendedRoas: number;
  ncRoas: number;
  cac: number;
  orders: number;
  sharePct: number;
}

export interface GrowthSprint {
  phase: string;
  period: string;
  targetRevenue: string;
  projectedProfit: string;
  theme: string;
  deliverables: string[];
  status: 'In Progress' | 'Upcoming' | 'Planned';
}

export interface AdPlatformDeepMetric {
  id: string;
  name: string;
  subtitle: string;
  badge: string;
  badgeType: 'meta' | 'tiktok' | 'google' | 'snapchat';
  iconBg: string;
  spend: number;
  revenue: number;
  roas: number;
  ncRoas: number;
  cpm: number;
  cpc: number;
  ctr: number;
  purchases: number;
  hookRate?: number;
  holdRate?: number;
  topCampaign: string;
  aiRecommendation: string;
  status: 'Scaling' | 'Optimal' | 'High ROI' | 'Testing';
}

export interface AdCreativePerformance {
  id: string;
  title: string;
  format: string;
  platform: 'Meta' | 'TikTok' | 'Snapchat' | 'Google';
  spend: number;
  revenue: number;
  roas: number;
  hookRate: number;
  thumbstop: number;
  fatigueStatus: 'Fresh' | 'Peak Winner' | 'Fatigued';
  action: string;
}

export interface BudgetReallocationItem {
  channel: string;
  platform: string;
  allocationAmount: number;
  allocationPct: number;
  marginalRoas: number;
  projectedRevenue: number;
  focusArea: string;
  impactScore: string;
}

export interface CohortRetention {
  cohort: string;
  customers: number;
  cac: number;
  day0Aov: number;
  month1Ltv: number;
  month3Ltv: number;
  month6Ltv: number;
  month12Ltv: number;
  ltvToCac: number;
}

export interface SeasonalCampaign {
  title: string;
  period: string;
  targetGmv: string;
  channelMix: string;
  priorityProducts: string;
  leadTime: string;
  status: 'Active' | 'Next Sprint' | 'Upcoming';
}

export interface AiInsight {
  type: 'scale' | 'rto' | 'inventory' | 'creative';
  badge: string;
  title: string;
  description: string;
  impact: string;
  action: string;
}

export interface ShopifyProduct {
  id: string;
  shopifyId: string;
  title: string;
  sku: string;
  barcode: string;
  category: string;
  tags: string[];
  price: number;
  compareAtPrice?: number;
  cogs: number;
  margin: number;
  inventoryQuantity: number;
  inventoryStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  variantsCount: number;
  image: string;
  syncedAt: string;
  syncStatus: 'synced' | 'syncing' | 'review';
  unitsSold: number;
  grossRevenue: number;
  netProfit: number;
  roas: number;
  rtoRate: number;
  rtoStatus: 'Low' | 'Moderate' | 'High Risk';
  topAdChannel: string;
  aiPrompt?: string;
  aiPromptUpdatedAt?: string;
  aiPromptTrained?: boolean;
  aiOptions?: {
    autoAdCopy?: boolean;
    rtoScoring?: boolean;
    weight?: 'Standard' | 'High' | 'Aggressive';
  };
}

export interface IntegrationField {
  id: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'url';
  placeholder: string;
  helpText: string;
  required: boolean;
  value: string;
  isSecret?: boolean;
  showSecret?: boolean;
  options?: { label: string; value: string }[];
}

export interface IntegrationDocConfig {
  portalName: string;
  docUrl: string;
  guideSteps: string[];
  fields: IntegrationField[];
}

export interface WhatsAppChatMessage {
  id: string;
  sender: 'customer' | 'ai';
  text: string;
  type?: 'text' | 'voice';
  voice_transcription?: string;
  timestamp: string;
  status?: 'sent' | 'delivered' | 'read';
  isAiResponse?: boolean;
  matched_products?: Array<{ id: string; title: string; price: number; image?: string }>;
  order_id?: string;
}

export interface WhatsAppCustomerConversation {
  id: string;
  customerName: string;
  customerPhone: string;
  avatar: string;
  city: string;
  status: string;
  statusType: 'success' | 'warning' | 'info';
  lastMessage: string;
  lastTimestamp: string;
  unreadCount?: number;
  messages: WhatsAppChatMessage[];
}

export interface StoreOrder {
  id: string;
  store_id: string;
  order_number: string;
  channel: 'shopify' | 'whatsapp';
  shopify_order_id?: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  address: string;
  city: string;
  postal_code?: string;
  items: Array<{ title: string; price: number; quantity: number; sku?: string; image_url?: string }>;
  total_amount: number;
  payment_method: 'cod' | 'online';
  payment_status: 'pending' | 'paid';
  order_status: 'unfulfilled' | 'fulfilled' | 'delivered' | 'cancelled';
  courier_name?: string;
  tracking_number?: string;
  whatsapp_conversation_id?: string;
  tags?: string[];
  created_at: string;
}

export interface AiGrowthInsights {
  hasSufficientData: boolean;
  summary: string;
  channelPerformance?: Array<{ platform: string; status: 'scale' | 'maintain' | 'optimize' | string; recommendation: string }>;
  courierTelemetry?: Array<{ courier: string; rating: string; routingAdvice: string }>;
  keyInsights: string[];
  metrics: Array<{ label: string; value: string; status: 'good' | 'warning' | 'critical' | 'neutral'; advice: string }>;
  opportunities: string[];
  risks: string[];
  suggestions: string[];
  channels?: {
    store_id: string;
    has_sufficient_data: boolean;
    financials: { gross_revenue: number; total_orders: number; catalog_skus: number };
    ads: Array<{
      platform: string;
      platform_id: string;
      spend: number;
      revenue: number;
      roas: number;
      clicks: number;
      ctr: string;
      cpc: number;
      conversions: number;
    }>;
    couriers: Array<{
      courier: string;
      dispatched: number;
      delivered: number;
      in_transit: number;
      returned_rto: number;
      delivery_success_rate: number;
      rto_rate: number;
      cod_collected: number;
      shipping_fees: number;
    }>;
    whatsapp: {
      total_conversations: number;
      voice_notes: number;
      orders_booked: number;
      revenue_generated: number;
      conversion_rate: number;
    };
    shopify: {
      orders_count: number;
      revenue: number;
      catalog_skus: number;
    };
  };
}



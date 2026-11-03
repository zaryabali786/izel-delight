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

// ── Omnichannel Support Channels (DelightChat Style) ─────────────────────────

export interface SupportChannelItem {
  id: string;
  store_id: string;
  channel_type: 'shopify' | 'facebook' | 'instagram' | 'whatsapp' | 'email';
  name: string;
  account_id: string;
  status: 'connected' | 'disconnected' | 'needs_reauth' | 'error' | 'syncing';
  webhook_verified: boolean;
  settings: Record<string, any>;
  last_synced_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UnifiedCustomer {
  id: string;
  store_id?: string;
  name: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  shopify_customer_id?: string;
  facebook_psid?: string;
  instagram_id?: string;
  whatsapp_phone?: string;
  orders_count: number;
  total_spent: number;
  city?: string;
  metadata?: Record<string, any>;
}

export interface ConversationMessageItem {
  id: string;
  conversation_id: string;
  sender_type: 'customer' | 'agent' | 'ai' | 'system';
  sender_name?: string;
  sender_id?: string;
  message_text: string;
  message_type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'comment';
  attachments?: any[];
  status: 'sent' | 'delivered' | 'read' | 'failed';
  is_private_note?: boolean;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface ShopifyCustomerContext {
  customer_id?: string;
  name: string;
  email?: string;
  phone?: string;
  total_orders: number;
  total_spent: number;
  recent_orders: StoreOrder[];
}

export interface OmnichannelConversation {
  id: string;
  store_id: string;
  channel_id?: string;
  channel_type: 'whatsapp' | 'facebook_messenger' | 'facebook_comment' | 'facebook_ad_comment' | 'instagram_dm' | 'instagram_comment' | 'instagram_ad_comment' | 'email';
  customer_id?: string;
  customer?: UnifiedCustomer;
  channel?: { name: string; type: string; account_id: string };
  external_thread_id?: string;
  subject?: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'normal' | 'high' | 'urgent';
  assigned_agent?: string;
  last_message_at: string;
  last_message_preview: string;
  unread_count: number;
  metadata?: {
    post_id?: string;
    ad_id?: string;
    ad_name?: string;
    is_ad?: boolean;
    permalink_url?: string;
    comment_id?: string;
    can_reply_privately?: boolean;
    to_email?: string;
    from_email?: string;
    ai_paused?: boolean;
  };
  messages?: ConversationMessageItem[];
  shopifyContext?: ShopifyCustomerContext;
}




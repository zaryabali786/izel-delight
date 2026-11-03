-- ==============================================================================
-- DB TECHNOLOGY NEXUS - MULTI-TENANT SAAS DATABASE SCHEMA FOR SUPABASE
-- Run this script in your Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. STORES TABLE (Tenants)
CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Shopify',
  currency TEXT NOT NULL DEFAULT 'PKR',
  currency_symbol TEXT NOT NULL DEFAULT 'PKR ',
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user store lookups
CREATE INDEX IF NOT EXISTS idx_stores_user_id ON public.stores(user_id);

-- 2. STORE INTEGRATIONS TABLE
CREATE TABLE IF NOT EXISTS public.store_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  config JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_store_integrations_store_id ON public.store_integrations(store_id);

-- 3. STORE PRODUCTS CATALOG TABLE
CREATE TABLE IF NOT EXISTS public.store_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sku TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  compare_at_price NUMERIC(12,2),
  stock INT NOT NULL DEFAULT 0,
  vendor TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  image_url TEXT,
  returns_rate NUMERIC(5,2) DEFAULT 0,
  rto_risk TEXT DEFAULT 'Low',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_products_store_id ON public.store_products(store_id);

-- 4. STORE ANALYTICS & FINANCIAL WATERFALL
CREATE TABLE IF NOT EXISTS public.store_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  gross_revenue NUMERIC(14,2) DEFAULT 0,
  net_sales NUMERIC(14,2) DEFAULT 0,
  ad_spend NUMERIC(14,2) DEFAULT 0,
  cogs NUMERIC(14,2) DEFAULT 0,
  rto_loss NUMERIC(14,2) DEFAULT 0,
  courier_fees NUMERIC(14,2) DEFAULT 0,
  net_profit NUMERIC(14,2) DEFAULT 0,
  net_margin_pct NUMERIC(5,2) DEFAULT 0,
  total_orders INT DEFAULT 0,
  aov NUMERIC(10,2) DEFAULT 0,
  channel_data JSONB DEFAULT '[]'::jsonb,
  insights JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures each user can strictly access only their own stores & store data!
-- ==============================================================================

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_metrics ENABLE ROW LEVEL SECURITY;

-- Stores policies
CREATE POLICY "Users can view their own stores"
  ON public.stores FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own stores"
  ON public.stores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own stores"
  ON public.stores FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own stores"
  ON public.stores FOR DELETE
  USING (auth.uid() = user_id);

-- Integrations policies
CREATE POLICY "Users can view their store integrations"
  ON public.store_integrations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert store integrations"
  ON public.store_integrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update store integrations"
  ON public.store_integrations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete store integrations"
  ON public.store_integrations FOR DELETE
  USING (auth.uid() = user_id);

-- Products policies
CREATE POLICY "Users can view products of their stores"
  ON public.store_products FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = store_products.store_id AND stores.user_id = auth.uid()));

CREATE POLICY "Users can insert products into their stores"
  ON public.store_products FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = store_products.store_id AND stores.user_id = auth.uid()));

CREATE POLICY "Users can update products of their stores"
  ON public.store_products FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = store_products.store_id AND stores.user_id = auth.uid()));

CREATE POLICY "Users can delete products of their stores"
  ON public.store_products FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = store_products.store_id AND stores.user_id = auth.uid()));

-- Metrics policies
CREATE POLICY "Users can view their store metrics"
  ON public.store_metrics FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = store_metrics.store_id AND stores.user_id = auth.uid()));

CREATE POLICY "Users can manage their store metrics"
  ON public.store_metrics FOR ALL
  USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = store_metrics.store_id AND stores.user_id = auth.uid()));

-- ==============================================================================
-- 5. SUPPORT CHANNELS (DelightChat-Style Omnichannel)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.support_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  channel_type TEXT NOT NULL, -- 'shopify', 'facebook', 'instagram', 'whatsapp', 'email'
  name TEXT NOT NULL,
  account_id TEXT, -- Page ID, IG Business ID, Phone ID, Email, Shop domain
  status TEXT NOT NULL DEFAULT 'connected', -- 'connected', 'disconnected', 'needs_reauth', 'error', 'syncing'
  credentials_encrypted TEXT,
  webhook_verified BOOLEAN DEFAULT false,
  settings JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, channel_type, account_id)
);

CREATE INDEX IF NOT EXISTS idx_support_channels_store_id ON public.support_channels(store_id);

-- 6. UNIFIED CUSTOMERS TABLE
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  shopify_customer_id TEXT,
  facebook_psid TEXT,
  instagram_id TEXT,
  whatsapp_phone TEXT,
  orders_count INT DEFAULT 0,
  total_spent NUMERIC(12,2) DEFAULT 0,
  city TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_store_id ON public.customers(store_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(store_id, email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(store_id, phone);

-- 7. UNIFIED CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.support_channels(id) ON DELETE SET NULL,
  channel_type TEXT NOT NULL, -- 'whatsapp', 'facebook_messenger', 'facebook_comment', 'facebook_ad_comment', 'instagram_dm', 'instagram_comment', 'instagram_ad_comment', 'email'
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  external_thread_id TEXT,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- 'open', 'pending', 'resolved', 'closed'
  priority TEXT NOT NULL DEFAULT 'normal',
  assigned_agent TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT,
  unread_count INT DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb, -- post_id, ad_id, permalink, comment_id, is_ad, ad_name, campaign_name
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_store_id ON public.conversations(store_id);
CREATE INDEX IF NOT EXISTS idx_conversations_channel ON public.conversations(store_id, channel_type);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON public.conversations(customer_id);

-- 8. CONVERSATION MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  external_message_id TEXT,
  sender_type TEXT NOT NULL, -- 'customer', 'agent', 'ai', 'system'
  sender_name TEXT,
  sender_id TEXT,
  message_text TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text', -- 'text', 'image', 'video', 'audio', 'document', 'comment'
  attachments JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'delivered', -- 'sent', 'delivered', 'read', 'failed'
  is_private_note BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb, -- comment_id, parent_comment_id, likes_count, can_reply_privately
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_store_id ON public.conversation_messages(store_id);

-- RLS POLICIES FOR NEW TABLES
ALTER TABLE public.support_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage support channels of their stores"
  ON public.support_channels FOR ALL
  USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = support_channels.store_id AND stores.user_id = auth.uid()));

CREATE POLICY "Users can manage customers of their stores"
  ON public.customers FOR ALL
  USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = customers.store_id AND stores.user_id = auth.uid()));

CREATE POLICY "Users can manage conversations of their stores"
  ON public.conversations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = conversations.store_id AND stores.user_id = auth.uid()));

CREATE POLICY "Users can manage messages of their stores"
  ON public.conversation_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = conversation_messages.store_id AND stores.user_id = auth.uid()));


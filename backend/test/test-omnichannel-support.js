require('dotenv').config();
const assert = require('assert');
const StoreService = require('../src/services/store.service');
const SupportChannelsService = require('../src/services/support-channels.service');
const ShopifyService = require('../src/services/shopify.service');

async function runTests() {
  console.log('🧪 Starting Omnichannel Support & Shopify Multi-Tenant Test Suite...\n');

  const userId = 'user-test-uuid-12345';
  const storeAId = 'store-tenant-alpha-001';
  const storeBId = 'store-tenant-beta-002';

  // 1. Setup Store A and Store B in local DB
  const db = require('../src/services/store.service');
  const localDb = db.readLocalDb ? db.readLocalDb() : { stores: [], support_channels: [], customers: [], conversations: [], conversation_messages: [], orders: [] };

  // Clean test stores if any
  localDb.stores = localDb.stores.filter((s) => s.id !== storeAId && s.id !== storeBId);
  localDb.support_channels = localDb.support_channels.filter((c) => c.store_id !== storeAId && c.store_id !== storeBId);
  localDb.conversations = localDb.conversations.filter((c) => c.store_id !== storeAId && c.store_id !== storeBId);
  localDb.customers = localDb.customers.filter((c) => c.store_id !== storeAId && c.store_id !== storeBId);
  localDb.orders = localDb.orders.filter((o) => o.store_id !== storeAId && o.store_id !== storeBId);

  localDb.stores.push(
    {
      id: storeAId,
      user_id: userId,
      name: 'Izel Apparel Official (Store A)',
      domain: 'izelapparel.myshopify.com',
      platform: 'Shopify',
      currency: 'PKR',
      currency_symbol: 'PKR ',
      status: 'active',
      created_at: new Date().toISOString(),
    },
    {
      id: storeBId,
      user_id: userId,
      name: 'Nexus Tech Store (Store B)',
      domain: 'nexustech.myshopify.com',
      platform: 'Shopify',
      currency: 'PKR',
      currency_symbol: 'PKR ',
      status: 'active',
      created_at: new Date().toISOString(),
    }
  );

  require('fs').writeFileSync(
    require('path').join(__dirname, '../data/stores_db.json'),
    JSON.stringify(localDb, null, 2)
  );

  console.log('✅ 1. Stores A & B created.');

  // 2. Test Shopify OAuth URL Generation (No manual token input!)
  const authUrlA = ShopifyService.generateAuthUrl('izelapparel.myshopify.com', storeAId, userId);
  assert(authUrlA.includes('izelapparel.myshopify.com/admin/oauth/authorize'), 'Auth URL must point to Shopify OAuth endpoint');
  assert(authUrlA.includes('state='), 'Auth URL must contain signed state parameter');
  assert(authUrlA.includes('read_products') && authUrlA.includes('read_orders'), 'Auth URL must include required deep scopes');
  console.log('✅ 2. Shopify OAuth URL generation verified.');

  // 3. Connect Channels for Store A
  // Email Channel
  const emailChannelA = await SupportChannelsService.connectEmailChannel(storeAId, userId, 'support@izelapparel.com', 'Izel Support');
  assert(emailChannelA.channel_type === 'email', 'Channel type should be email');
  assert(emailChannelA.settings.inbound_address.includes('inbound.thesellsphere.com'), 'Inbound forwarding address generated');

  // Facebook Channel
  const fbChannelA = await StoreService.upsertSupportChannel(storeAId, userId, {
    channel_type: 'facebook',
    name: 'Facebook: Izel Apparel',
    account_id: 'page_fb_1001',
    status: 'connected',
    settings: { page_id: 'page_fb_1001', page_name: 'Izel Apparel', supports_ad_comments: true },
  });

  // Instagram Channel
  const igChannelA = await StoreService.upsertSupportChannel(storeAId, userId, {
    channel_type: 'instagram',
    name: 'Instagram: @izelapparel',
    account_id: 'ig_user_2001',
    status: 'connected',
    settings: { username: 'izelapparel', supports_ad_comments: true },
  });

  // WhatsApp Channel
  const waChannelA = await StoreService.upsertSupportChannel(storeAId, userId, {
    channel_type: 'whatsapp',
    name: 'WhatsApp: +92 300 1234567',
    account_id: 'wa_phone_3001',
    status: 'connected',
    settings: { phone_number: '+92 300 1234567' },
  });

  console.log('✅ 3. Store A connected 4 channels (Email, FB, IG, WA).');

  // 4. Connect Channels for Store B
  const emailChannelB = await SupportChannelsService.connectEmailChannel(storeBId, userId, 'help@nexustech.com', 'Nexus Helpdesk');
  const fbChannelB = await StoreService.upsertSupportChannel(storeBId, userId, {
    channel_type: 'facebook',
    name: 'Facebook: Nexus Tech',
    account_id: 'page_fb_9999',
    status: 'connected',
    settings: { page_id: 'page_fb_9999', page_name: 'Nexus Tech' },
  });
  console.log('✅ 4. Store B connected separate channels.');

  // 5. Multi-Tenant Channel Isolation Verification
  const storeAChannels = await StoreService.getStoreSupportChannels(storeAId);
  const storeBChannels = await StoreService.getStoreSupportChannels(storeBId);

  assert.strictEqual(storeAChannels.length, 4, 'Store A must have 4 channels');
  assert.strictEqual(storeBChannels.length, 2, 'Store B must have 2 channels');
  assert(!storeAChannels.some((c) => c.name.includes('Nexus')), 'Store A must NOT see Store B channels!');
  assert(!storeBChannels.some((c) => c.name.includes('Izel')), 'Store B must NOT see Store A channels!');
  console.log('🔒 5. Strict multi-tenant channel isolation verified.');

  // 6. Test Inbound Email Forwarding & Conversation Threading for Store A
  const inboundRes = await SupportChannelsService.handleInboundEmail({
    from: 'Fatima Noor <fatima@gmail.com>',
    to: emailChannelA.settings.inbound_address,
    subject: 'Question regarding order tracking #ORD-99120',
    text: 'Hello, when will my summer lawn dress be dispatched? Thank you!',
    messageId: '<msg-101@mail.gmail.com>',
  });
  assert(inboundRes.success, 'Inbound email must process successfully');
  assert.strictEqual(inboundRes.storeId, storeAId, 'Must resolve to Store A');

  const storeAConvs = await StoreService.getStoreConversations(storeAId);
  const storeBConvs = await StoreService.getStoreConversations(storeBId);
  assert.strictEqual(storeAConvs.length, 1, 'Store A must have 1 conversation ticket');
  assert.strictEqual(storeBConvs.length, 0, 'Store B must have 0 conversation tickets');
  console.log('🔒 6. Inbound email and conversation isolation verified.');

  // 7. Test Customer Identity Resolution & Shopify Context
  // Create Shopify customer order in Store A
  await StoreService.createStoreOrder(storeAId, {
    order_number: 'ORD-99120',
    channel: 'shopify',
    customer_name: 'Fatima Noor',
    customer_email: 'fatima@gmail.com',
    customer_phone: '+923007654321',
    total_amount: 8500,
    payment_method: 'cod',
    payment_status: 'pending',
    order_status: 'shipped',
    courier_name: 'PostEx Logistics',
    tracking_number: 'PEX-84910284',
    items: [{ title: 'Embroidered Lawn 3-Piece Suite', price: 8500, quantity: 1, sku: 'IZ-LWN-01' }],
  });

  // Fetch conversation with details & Shopify context
  const convDetails = await StoreService.getConversationWithDetails(storeAId, inboundRes.conversationId);
  assert(convDetails.customer, 'Customer details must be resolved');
  assert.strictEqual(convDetails.customer.email, 'fatima@gmail.com');
  assert(convDetails.shopifyContext, 'Shopify context must be resolved');
  assert.strictEqual(convDetails.shopifyContext.total_orders, 1, 'Should match customer order in Shopify');
  assert.strictEqual(convDetails.shopifyContext.total_spent, 8500, 'Should match total spend in Shopify');
  assert.strictEqual(convDetails.shopifyContext.recent_orders[0].tracking_number, 'PEX-84910284');
  console.log('✨ 7. Customer identity resolution & deep Shopify context verified.');

  // 8. Test Meta Ingestion (Ad Comment Detection)
  await SupportChannelsService.processIncomingMetaComment(
    'page_fb_1001',
    {
      item: 'comment',
      comment_id: 'fb_comment_98765',
      post_id: 'act_102938_ad_4891',
      ad_id: 'ad_summer_sale_2026',
      ad_name: 'Summer Lawn Drop (Meta Ads Campaign)',
      message: 'Is this available in size Small and what is the delivery time to Islamabad?',
      from: { id: 'fb_user_555', name: 'Zainab Ahmed' },
      is_ad: true,
    },
    false
  );

  const updatedConvs = await StoreService.getStoreConversations(storeAId);
  const adCommentConv = updatedConvs.find((c) => c.channel_type === 'facebook_ad_comment');
  assert(adCommentConv, 'Facebook ad comment conversation must be created');
  assert(adCommentConv.metadata.is_ad, 'Must flag as Ad comment');
  assert.strictEqual(adCommentConv.metadata.ad_id, 'ad_summer_sale_2026', 'Must store ad identifier');
  console.log('🎯 8. Meta Ad comment ingestion with campaign/ad metadata verified.');

  console.log('\n🎉 ALL TESTS PASSED! Multi-tenant omnichannel support channels & Shopify deep integration verified successfully.\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

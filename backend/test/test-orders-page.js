require('dotenv').config();
const StoreService = require('../src/services/store.service');

async function testOrdersPage() {
  console.log('🧪 Starting Orders Pipeline & Tagging Test Suite...\n');

  // 1. Create isolated store
  const store = await StoreService.createStore('99999999-9999-9999-9999-999999999999', {
    name: 'Sapphire Pret Studio',
    domain: 'sapphire-pret.myshopify.com',
    currency: 'PKR',
  });
  console.log(`1️⃣ Store created: ${store.name} (${store.id})`);

  // 2. Create WhatsApp Order
  const waOrder = await StoreService.createStoreOrder(store.id, {
    channel: 'whatsapp',
    customer_name: 'Zaryab Khan',
    customer_phone: '+923001234567',
    customer_email: 'zaryab@example.com',
    address: 'House #42, Block 6, Gulshan-e-Iqbal',
    city: 'Karachi',
    total_amount: 5450,
    payment_method: 'cod',
    payment_status: 'pending',
    order_status: 'unfulfilled',
    items: [
      {
        title: 'Midnight Black Embroidered Kurti (Medium)',
        price: 5450,
        quantity: 1,
        sku: 'KURTI-BLK-M',
      },
    ],
  });
  console.log(`2️⃣ WhatsApp Order created: ${waOrder.order_number}`);
  console.log(`   Tags: ${JSON.stringify(waOrder.tags)}`);
  if (!waOrder.tags.includes('Order from WhatsApp')) {
    throw new Error('Expected tag "Order from WhatsApp" not found on WhatsApp order!');
  }

  // 3. Create Shopify Order
  const shopifyOrder = await StoreService.createStoreOrder(store.id, {
    channel: 'shopify',
    shopify_order_id: '78291034',
    customer_name: 'Ayesha Malik',
    customer_phone: '+923219876543',
    customer_email: 'ayesha@example.com',
    address: 'Plaza 14, DHA Phase 5',
    city: 'Lahore',
    total_amount: 12800,
    payment_method: 'online',
    payment_status: 'paid',
    order_status: 'fulfilled',
    items: [
      {
        title: 'Raw Silk Festive Ensemble (Small)',
        price: 12800,
        quantity: 1,
        sku: 'SILK-FST-S',
      },
    ],
  });
  console.log(`3️⃣ Shopify Order created: ${shopifyOrder.order_number}`);
  console.log(`   Shopify Ref: #${shopifyOrder.shopify_order_id}, Tags: ${JSON.stringify(shopifyOrder.tags)}`);

  // 4. Test Query All Orders
  const allOrders = await StoreService.getStoreOrders(store.id, 'all');
  console.log(`4️⃣ Total Orders in Pipeline: ${allOrders.length}`);
  if (allOrders.length !== 2) throw new Error('Expected 2 orders in total!');

  // 5. Test Filter WhatsApp
  const waOrders = await StoreService.getStoreOrders(store.id, 'whatsapp');
  console.log(`5️⃣ Filter WhatsApp Orders: ${waOrders.length}`);
  if (waOrders.length !== 1 || waOrders[0].tags[0] !== 'Order from WhatsApp') {
    throw new Error('WhatsApp filter failed!');
  }

  // 6. Test Filter Shopify
  const shOrders = await StoreService.getStoreOrders(store.id, 'shopify');
  console.log(`6️⃣ Filter Shopify Orders: ${shOrders.length}`);
  if (shOrders.length !== 1 || !shOrders[0].shopify_order_id) {
    throw new Error('Shopify filter failed!');
  }

  // 7. Verify Multi-Channel Telemetry Integration
  const telemetry = await StoreService.getStoreMultiChannelTelemetry(store.id);
  console.log(`7️⃣ Real Multi-Channel Telemetry:`);
  console.log(`   Gross Revenue: PKR ${telemetry.financials.gross_revenue}`);
  console.log(`   WhatsApp Orders: ${telemetry.whatsapp.orders_booked}`);
  console.log(`   Shopify Orders: ${telemetry.shopify.orders_count}`);

  // Cleanup
  await StoreService.deleteStore(store.id, '99999999-9999-9999-9999-999999999999');
  console.log('\n🧹 Test store cleaned up successfully.');
  console.log('🎉 ALL ORDERS PIPELINE & TAGGING TESTS PASSED GLORIOUSLY!');
}

testOrdersPage().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

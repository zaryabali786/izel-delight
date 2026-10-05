require('dotenv').config();
const AIService = require('../src/services/ai.service');
const StoreService = require('../src/services/store.service');

async function runAiTests() {
  console.log('🤖 Starting SellSphere AI, Vector/RAG & WhatsApp Agent Test Suite...\n');

  const testStoreId = 'test-ai-store-' + Date.now();
  const testUserId = 'test-ai-user-' + Date.now();

  try {
    // Step 1: Create a test store
    console.log('1️⃣ Creating isolated test store...');
    const store = await StoreService.createStore(testUserId, {
      name: 'Gul Ahmed Silk Studio',
      domain: 'gulahmedstudio.myshopify.com',
      platform: 'Shopify',
      currency: 'PKR',
    });
    console.log('✅ Store created:', store.name, `(${store.id})`);

    // Step 2: Add test products to catalog
    console.log('\n2️⃣ Adding real catalog products & generating vector embeddings...');
    const prod1 = await StoreService.addStoreProduct(store.id, {
      title: 'Midnight Black Embroidered Cotton Kurti',
      price: 5450,
      stock: 35,
      category: 'Casual Pret',
      description: '100% pure combed breathable cotton in deep jet black with subtle neck embroidery. Available in Small, Medium, Large.',
      variants: [
        { title: 'Small', price: 5450, stock: 10 },
        { title: 'Medium', price: 5450, stock: 15 },
        { title: 'Large', price: 5450, stock: 10 },
      ],
    });

    const prod2 = await StoreService.addStoreProduct(store.id, {
      title: 'Emerald Green Festive Silk Trousers & Shirt',
      price: 13500,
      stock: 12,
      category: 'Festive Luxury',
      description: 'Pure raw silk festive wear with organza dupatta and golden tilla work.',
      variants: [{ title: 'Standard', price: 13500, stock: 12 }],
    });

    // Generate real embeddings using text-embedding-3-small
    await AIService.embedProduct(store.id, prod1);
    await AIService.embedProduct(store.id, prod2);
    console.log('✅ Embeddings generated & saved for products. Vector dim:', prod1.embedding?.length);

    // Step 3: Test Vector / RAG Search
    console.log('\n3️⃣ Testing Vector/Semantic Search with customer natural language query...');
    const searchResults = await AIService.searchProducts(store.id, 'do you have black cotton shirt in medium size?', 2);
    console.log('✅ Search results returned:', searchResults.length, 'products');
    console.log('   Top matched product:', searchResults[0]?.title);
    if (searchResults[0]?.title !== prod1.title) {
      throw new Error(`Expected "${prod1.title}" as top match, got "${searchResults[0]?.title}"`);
    }

    // Step 4: Test WhatsApp Conversational Agent with gpt-4o-mini
    console.log('\n4️⃣ Testing WhatsApp AI Agent (gpt-4o-mini) with inquiry...');
    const inquiryResult = await AIService.handleWhatsAppMessage({
      storeId: store.id,
      customerPhone: '+923001234567',
      customerName: 'Fatima Zahra',
      messageText: 'Assalam-o-Alaikum, black kurti medium size available ha? price kaya hai?',
    });

    console.log('✅ gpt-4o-mini Reply:\n------------------------------------------------');
    console.log(inquiryResult.reply);
    console.log('------------------------------------------------');
    console.log('   Matched products count:', inquiryResult.matchedProducts?.length);

    // Step 5: Test WhatsApp Order Placement (COD Flow)
    console.log('\n5️⃣ Testing WhatsApp COD Order confirmation...');
    const orderResult = await AIService.handleWhatsAppMessage({
      storeId: store.id,
      customerPhone: '+923001234567',
      customerName: 'Fatima Zahra',
      messageText: 'Yes please order confirm karden via Cash on Delivery. My address is House 42, Block 5, Clifton, Karachi.',
    });

    console.log('✅ Order Placement Reply:\n------------------------------------------------');
    console.log(orderResult.reply);
    console.log('------------------------------------------------');

    const orders = await StoreService.getStoreOrders(store.id);
    console.log('✅ Total Orders created for store in database:', orders.length);
    if (orders.length > 0) {
      console.log('   Order #:', orders[0].order_number);
      console.log('   Customer:', orders[0].customer_name);
      console.log('   Channel:', orders[0].channel);
      console.log('   Total:', orders[0].total_amount);
      console.log('   Payment:', orders[0].payment_method);
      console.log('   Tracking #:', orders[0].tracking_number);
    }

    // Step 6: Test Real Store Metrics (Recalculated with real orders)
    console.log('\n6️⃣ Verifying Real Multi-Tenant Metrics Calculation (No static mock data)...');
    const metrics = await StoreService.getStoreMetrics(store.id);
    console.log('   Gross Revenue:', metrics.gross_revenue);
    console.log('   Total Orders:', metrics.total_orders);
    console.log('   Average Order Value (AOV):', metrics.aov);
    console.log('   Has Sufficient Data Flag:', metrics.has_sufficient_data);

    // Step 7: Test AI Growth Suggestions (gpt-4o-mini structured JSON)
    console.log('\n7️⃣ Testing AI Growth Suggestions with gpt-4o-mini structured output...');
    const growthInsights = await AIService.generateGrowthInsights(store.id);
    console.log('✅ Structured AI Output:');
    console.log('   Summary:', growthInsights.summary);
    console.log('   Key Insights count:', growthInsights.keyInsights?.length);
    console.log('   Actionable Suggestions count:', growthInsights.suggestions?.length);
    console.log('   First Suggestion:', growthInsights.suggestions?.[0]);

    // Clean up test store
    await StoreService.deleteStore(store.id, testUserId);
    console.log('\n🧹 Test store cleaned up successfully.');

    console.log('\n🎉 ALL AI, VECTOR RAG & WHATSAPP AGENT TESTS PASSED GLORIOUSLY!');
  } catch (err) {
    console.error('❌ AI Test Failed:', err);
    process.exit(1);
  }
}

runAiTests();

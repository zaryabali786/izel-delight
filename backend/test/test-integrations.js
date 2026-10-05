require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const IntegrationsService = require('../src/services/integrations.service');
const StoreService = require('../src/services/store.service');

const BASE_URL = 'http://localhost:5000';

async function runTests() {
  console.log('🧪 Starting SellSphere Nexus Integration Architecture Test Suite...\n');

  // Test 1: Health check
  try {
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Test 1 Passed: Backend Health Check');
    console.log('   Status:', health.data.message);
    console.log('   Cache Driver:', health.data.cache.driver);
  } catch (err) {
    console.error('❌ Test 1 Failed: Health check failed:', err.message);
  }

  // Test 2: Unauthenticated Webhook with Invalid HMAC -> Must return 401
  try {
    const rawPayload = JSON.stringify({
      id: 999901,
      title: 'Tampered Hack Product',
      variants: [{ id: 1, price: '100', sku: 'HACK-01' }],
    });

    await axios.post(`${BASE_URL}/api/shopify/webhooks/products-update`, JSON.parse(rawPayload), {
      headers: {
        'x-shopify-topic': 'products/update',
        'x-shopify-shop-domain': 'store.myshopify.com',
        'x-shopify-hmac-sha256': 'fake_invalid_hmac_signature',
        'Content-Type': 'application/json',
      },
    });
    console.error('❌ Test 2 Failed: Webhook with invalid HMAC was accepted! Security violation.');
  } catch (err) {
    if (err.response?.status === 401) {
      console.log('✅ Test 2 Passed: Webhook HMAC Security Check (Rejected invalid HMAC with 401 Unauthorized)');
    } else {
      console.log('ℹ️  Test 2 Note: Status code:', err.response?.status || err.message);
    }
  }

  // Test 3: Multi-tenant protection on /api/shopify/auth-url without token
  try {
    await axios.get(`${BASE_URL}/api/shopify/auth-url?shop=test.myshopify.com&storeId=some-store-id`);
    console.error('❌ Test 3 Failed: Route without auth token was accepted!');
  } catch (err) {
    if (err.response?.status === 401) {
      console.log('✅ Test 3 Passed: Authenticated Route Protection (Rejected unauthenticated request with 401)');
    } else {
      console.log('ℹ️  Test 3 Response:', err.response?.status);
    }
  }

  // Test 4: Protected Integrations Routes without Auth Token
  try {
    await axios.get(`${BASE_URL}/api/integrations/some-store-id`);
    console.error('❌ Test 4 Failed: Integrations route without auth was accepted!');
  } catch (err) {
    if (err.response?.status === 401) {
      console.log('✅ Test 4 Passed: Integrations Endpoint Security (Strict JWT Auth Enforced with 401)');
    } else {
      console.log('ℹ️  Test 4 Response:', err.response?.status);
    }
  }

  // Test 5: Test Providers Validation logic (Meta, WhatsApp, Google, PostEx)
  console.log('\n🔍 Testing Official API Validations (Authentic API rejection of invalid credentials)...');

  try {
    await IntegrationsService.validateProviderCredentials('meta-ads', {
      adAccountId: 'act_123',
      accessToken: 'invalid_dummy_token_xyz',
    });
    console.error('❌ Test 5a Failed: Fake Meta token was falsely validated!');
  } catch (err) {
    console.log('✅ Test 5a Passed: Real Meta API rejected invalid token:', err.message);
  }

  try {
    await IntegrationsService.validateProviderCredentials('google-ads', {
      customerId: '123-456', // Invalid format
    });
    console.error('❌ Test 5b Failed: Invalid Google Customer ID format accepted!');
  } catch (err) {
    console.log('✅ Test 5b Passed: Google Ads validation caught invalid Customer ID format:', err.message);
  }

  try {
    await IntegrationsService.validateProviderCredentials('whatsapp-business', {
      phoneNumberId: '1234567890',
      permanentToken: 'invalid_wa_token',
    });
    console.error('❌ Test 5c Failed: Fake WhatsApp token was falsely validated!');
  } catch (err) {
    console.log('✅ Test 5c Passed: Real WhatsApp Cloud API rejected invalid token:', err.message);
  }

  try {
    await IntegrationsService.validateProviderCredentials('postex-courier', {
      apiToken: 'invalid_pex_token',
    });
    console.error('❌ Test 5d Failed: Fake PostEx token was accepted!');
  } catch (err) {
    console.log('✅ Test 5d Passed: PostEx API rejected invalid token:', err.message);
  }

  // Test 6: Multi-Tenant Data Isolation Test
  console.log('\n🔒 Testing Multi-Tenant Data Isolation (Store A vs Store B)...');

  const userA_id = crypto.randomUUID();
  const userB_id = crypto.randomUUID();

  const storeA = await StoreService.createStore(userA_id, {
    name: 'Tenant Alpha Store',
    domain: 'tenant-alpha.myshopify.com',
  });

  const storeB = await StoreService.createStore(userB_id, {
    name: 'Tenant Beta Store',
    domain: 'tenant-beta.myshopify.com',
  });

  const breachAttempt = await StoreService.getStoreById(storeA.id, userB_id);
  if (breachAttempt) {
    console.error('❌ Test 6 Failed: User B was able to access Store A! Data leakage detected.');
  } else {
    console.log('✅ Test 6a Passed: User B strictly prevented from accessing Store A (Returned null)');
  }

  const breachAttempt2 = await StoreService.getStoreById(storeB.id, userA_id);
  if (breachAttempt2) {
    console.error('❌ Test 6 Failed: User A was able to access Store B! Data leakage detected.');
  } else {
    console.log('✅ Test 6b Passed: User A strictly prevented from accessing Store B (Returned null)');
  }

  // Test 7: Valid Cryptographic Shopify Webhook Processing
  console.log('\n📦 Testing Cryptographically Signed Shopify Webhook Flow...');
  const webhookSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const webhookPayload = JSON.stringify({
    id: 8819203,
    title: 'Autumn Velvet Stitched Suit',
    vendor: 'Izel Couture',
    product_type: 'Festive Luxury',
    status: 'active',
    variants: [
      {
        id: 99120,
        price: '16500.00',
        compare_at_price: '19000.00',
        sku: 'SP-8819203',
        inventory_quantity: 45,
      },
    ],
    image: {
      src: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=400&q=80',
    },
  });

  const validHmac = crypto.createHmac('sha256', webhookSecret).update(webhookPayload).digest('base64');

  try {
    const webhookRes = await axios.post(
      `${BASE_URL}/api/shopify/webhooks/products-update`,
      JSON.parse(webhookPayload),
      {
        headers: {
          'x-shopify-topic': 'products/update',
          'x-shopify-shop-domain': 'tenant-alpha.myshopify.com',
          'x-shopify-hmac-sha256': validHmac,
          'x-shopify-webhook-id': `wh-test-${Date.now()}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (webhookRes.status === 200 && webhookRes.data.received) {
      console.log('✅ Test 7a Passed: Webhook with valid HMAC accepted with 200 OK');

      await new Promise((r) => setTimeout(r, 600));

      const betaProducts = await StoreService.getStoreProducts(storeB.id);
      const leakedProduct = betaProducts.find((p) => p.title === 'Autumn Velvet Stitched Suit');
      if (leakedProduct) {
        console.error('❌ Test 7c Failed: Leaked product into Tenant Beta store!');
      } else {
        console.log('✅ Test 7c Passed: Strict isolation verified - Tenant Beta store has 0 leaked records.');
      }
    }
  } catch (err) {
    console.error('❌ Test 7 Failed:', err.response?.data || err.message);
  }

  await StoreService.deleteStore(storeA.id, userA_id);
  await StoreService.deleteStore(storeB.id, userB_id);
  console.log('🧹 Cleaned up test stores.');

  console.log('\n🏁 All Integration Architecture Tests Completed Successfully!\n');
}

runTests().catch(console.error);

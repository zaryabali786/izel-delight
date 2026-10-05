const OpenAI = require('openai');
const { toFile } = require('openai');
const StoreService = require('./store.service');
const { emitToStore } = require('./realtime.service');

// Initialize OpenAI client with server-side API Key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * High-performance cosine similarity for vector comparison
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const AIService = {
  /**
   * 1. Generate text embedding using text-embedding-3-small
   */
  async generateEmbedding(text) {
    if (!text || !text.trim()) return [];
    try {
      const cleanText = text.replace(/\n+/g, ' ').slice(0, 8000);
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: cleanText,
      });
      return res.data[0].embedding;
    } catch (err) {
      console.error('[AIService] generateEmbedding error:', err.message);
      return [];
    }
  },

  /**
   * 2. Generate and attach embedding to a store product
   */
  async embedProduct(storeId, product) {
    try {
      const content = [
        `Title: ${product.title}`,
        product.category ? `Category: ${product.category}` : '',
        product.vendor ? `Brand: ${product.vendor}` : '',
        product.description ? `Description: ${product.description}` : '',
        `Price: PKR ${product.price}`,
        `Stock: ${product.stock}`,
        product.sku ? `SKU: ${product.sku}` : '',
        Array.isArray(product.variants) && product.variants.length > 0
          ? `Variants: ${product.variants.map((v) => `${v.title || v.name} (${v.price || product.price})`).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('. ');

      const embedding = await this.generateEmbedding(content);
      if (embedding && embedding.length > 0) {
        await StoreService.updateProductEmbedding(storeId, product.id, embedding);
        product.embedding = embedding;
      }
      return product;
    } catch (err) {
      console.warn(`[AIService] Could not embed product ${product.id}:`, err.message);
      return product;
    }
  },

  /**
   * 3. Vector / Semantic Product Search for a specific store (RAG retrieval)
   */
  async searchProducts(storeId, queryText, limit = 5) {
    const products = await StoreService.getStoreProducts(storeId);
    if (!products || products.length === 0) return [];

    const query = (queryText || '').trim().toLowerCase();
    if (!query) return products.slice(0, limit);

    // Try vector similarity if query has sufficient length
    try {
      const queryVec = await this.generateEmbedding(query);
      if (queryVec && queryVec.length > 0) {
        const scored = [];
        for (const p of products) {
          let score = 0;
          if (p.embedding && Array.isArray(p.embedding) && p.embedding.length > 0) {
            score = cosineSimilarity(queryVec, p.embedding);
          } else {
            // Lazy embed product in background for next time
            this.embedProduct(storeId, p).catch(() => {});
            // Fallback keyword score
            const titleMatch = p.title.toLowerCase().includes(query);
            const categoryMatch = (p.category || '').toLowerCase().includes(query);
            if (titleMatch) score = 0.75;
            else if (categoryMatch) score = 0.6;
          }

          // Boost score if title or category has exact words
          const words = query.split(/\s+/).filter((w) => w.length > 2);
          for (const w of words) {
            if (p.title.toLowerCase().includes(w)) score += 0.15;
            if ((p.category || '').toLowerCase().includes(w)) score += 0.1;
          }

          scored.push({ product: p, score });
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map((s) => s.product);
      }
    } catch (err) {
      console.warn('[AIService] Vector search error, falling back to keyword search:', err.message);
    }

    // Fallback: simple keyword matching
    const filtered = products.filter((p) => {
      const hay = `${p.title} ${p.category || ''} ${p.sku || ''} ${p.description || ''}`.toLowerCase();
      return query.split(/\s+/).some((token) => hay.includes(token));
    });

    return (filtered.length > 0 ? filtered : products).slice(0, limit);
  },

  /**
   * 4. Transcribe Audio (Voice Message) using Whisper
   */
  async transcribeAudio(audioBuffer, mimetype = 'audio/ogg') {
    try {
      const extension = mimetype.includes('mp4') || mimetype.includes('m4a') ? 'm4a' : mimetype.includes('wav') ? 'wav' : 'ogg';
      const file = await toFile(audioBuffer, `voice_note.${extension}`, { type: mimetype });

      const transcription = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
      });

      return transcription.text || '';
    } catch (err) {
      console.error('[AIService] Whisper STT error:', err.message);
      throw new Error(`Voice transcription failed: ${err.message}`);
    }
  },

  /**
   * 5. WhatsApp Conversational Agent with gpt-4o-mini & RAG
   */
  async handleWhatsAppMessage({ storeId, customerPhone, customerName, messageText, audioBuffer, audioMimetype }) {
    // 1. Verify store exists
    const store = await StoreService.getStoreByIdWithoutUser(storeId);
    if (!store) {
      throw new Error('Store not found.');
    }

    // 2. Handle voice message if audioBuffer provided
    let voiceTranscription = null;
    let actualText = (messageText || '').trim();
    const isVoice = !!audioBuffer;

    if (isVoice) {
      voiceTranscription = await this.transcribeAudio(audioBuffer, audioMimetype);
      actualText = voiceTranscription;
    }

    if (!actualText) {
      actualText = 'Hello';
    }

    // 3. Retrieve or create conversation for this customer
    const phone = (customerPhone || '+923000000000').trim();
    const name = (customerName || 'Customer').trim();
    let conversation = await StoreService.getOrCreateWhatsAppConversation(storeId, phone, name);

    // 4. Vector search relevant products for this inquiry
    const matchedProducts = await this.searchProducts(storeId, actualText, 4);

    // 5. Check if customer has any existing orders to provide real order status
    const recentOrders = await StoreService.getCustomerOrdersByPhone(storeId, phone);

    // 6. Build Store AI Prompt
    const customPrompt =
      store.settings?.ai_prompt ||
      `You are the official WhatsApp AI Sales & Support Executive for "${store.name}".
Help customers choose products, answer questions regarding fabrics, sizes, stock, and delivery, and assist them in placing orders.
We support Cash on Delivery (COD) across Pakistan (2-3 business days delivery via premier couriers) and Online Payment.
Always be polite, warm, and professional. Respond in the customer's language (English, Urdu, or Roman Urdu).
Never invent products, prices, or stock that are not in the provided catalog context. If an item is out of stock, inform them politely.`;

    // 7. Format available products context
    const productsContext =
      matchedProducts.length > 0
        ? matchedProducts
            .map(
              (p, idx) =>
                `Product #${idx + 1}:
- ID: ${p.id}
- Title: ${p.title}
- Price: ${store.currency_symbol || 'PKR '}${Number(p.price).toLocaleString()}
- Stock: ${p.stock > 0 ? `${p.stock} units available (In Stock)` : 'Out of Stock'}
- Category: ${p.category || 'Apparel'}
- SKU: ${p.sku || 'N/A'}
${p.description ? `- Details: ${p.description}` : ''}`
            )
            .join('\n\n')
        : 'No specific matching products found in the catalog for this inquiry.';

    // 8. Format order history context
    const ordersContext =
      recentOrders.length > 0
        ? recentOrders
            .map(
              (o) =>
                `Recent Order #${o.order_number || o.id}:
- Status: ${o.order_status}
- Total: ${store.currency_symbol || 'PKR '}${Number(o.total_amount).toLocaleString()}
- Payment: ${o.payment_method?.toUpperCase()} (${o.payment_status})
- Tracking: ${o.tracking_number ? `${o.courier_name} (${o.tracking_number})` : 'Processing shipment'}`
            )
            .join('\n')
        : 'Customer has no previous orders on record.';

    // 9. Format recent chat history (last 8 messages)
    const historyMessages = (conversation.messages || []).slice(-8).map((m) => ({
      role: m.sender === 'customer' ? 'user' : 'assistant',
      content: m.text,
    }));

    // 10. System instructions with strict JSON or Order Detection
    const systemPrompt = `${customPrompt}

STORE CONTEXT:
Store Name: ${store.name}
Platform: ${store.platform || 'Shopify'}
Currency: ${store.currency || 'PKR'} (${store.currency_symbol || 'PKR '})

AVAILABLE PRODUCTS IN STOCK:
${productsContext}

CUSTOMER ORDER HISTORY:
${ordersContext}

INSTRUCTIONS FOR ORDERING:
1. If the customer clearly expresses intent to buy or order (e.g. "order karna hai", "book this", "I want to buy", "buy medium"):
   - Ask whether they prefer "Cash on Delivery (COD)" or "Online Payment".
   - For Cash on Delivery (COD), ask for: Full Name, Delivery Address, City, Phone number, and Variant/Size.
   - For Online Payment, generate this exact payment link: https://example.com/payment/order/${storeId.slice(0, 8)}-${Date.now().toString().slice(-4)}
2. If the customer has provided their delivery details (Name, Address, City) and confirms an order:
   - Provide an enthusiastic confirmation message summarizing the article, price, delivery address, and expected delivery time (2-3 days).
   - In your internal response, you can indicate confirmation.
3. Keep responses natural, concise, and WhatsApp-friendly with appropriate emojis (🛍️, ✨, 🚚, 📦).`;

    // 11. Call gpt-4o-mini
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: actualText },
      ],
      temperature: 0.6,
      max_tokens: 650,
    });

    const aiReply = completion.choices[0]?.message?.content || 'Thank you for reaching out! How can I assist you with your order?';

    // 12. Check if an order should be automatically booked
    let createdOrder = null;
    const lowerText = (actualText + ' ' + aiReply).toLowerCase();
    const hasOrderConfirmation =
      (lowerText.includes('order confirmed') || lowerText.includes('booking id') || lowerText.includes('order placed') || lowerText.includes('delivery details')) &&
      matchedProducts.length > 0;

    if (hasOrderConfirmation) {
      const targetProduct = matchedProducts[0];
      createdOrder = await StoreService.createStoreOrder(storeId, {
        channel: 'whatsapp',
        customer_name: conversation.customer_name || name,
        customer_phone: phone,
        address: conversation.city ? `${conversation.city} Doorstep Delivery` : 'Delivery Address Provided via WhatsApp',
        city: conversation.city || 'Karachi',
        total_amount: Number(targetProduct.price) || 4500,
        payment_method: lowerText.includes('online') ? 'online' : 'cod',
        payment_status: lowerText.includes('online') ? 'pending' : 'pending',
        order_status: 'unfulfilled',
        courier_name: 'PostEx Logistics',
        whatsapp_conversation_id: conversation.id,
        items: [
          {
            product_id: targetProduct.id,
            title: targetProduct.title,
            price: Number(targetProduct.price),
            quantity: 1,
            sku: targetProduct.sku,
            image_url: targetProduct.image_url,
          },
        ],
      });
    }

    // 13. Record messages in conversation
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMsg = {
      id: `msg-${Date.now()}-cust`,
      sender: 'customer',
      text: actualText,
      type: isVoice ? 'voice' : 'text',
      voice_transcription: voiceTranscription,
      timestamp: timeNow,
      status: 'read',
    };

    const aiMsg = {
      id: `msg-${Date.now()}-ai`,
      sender: 'ai',
      text: aiReply,
      type: 'text',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'read',
      isAiResponse: true,
      matched_products: matchedProducts.map((p) => ({ id: p.id, title: p.title, price: p.price, image: p.image_url })),
      order_id: createdOrder ? createdOrder.id : null,
    };

    conversation.messages.push(userMsg, aiMsg);
    conversation.last_message = aiReply;
    conversation.last_timestamp = aiMsg.timestamp;
    if (createdOrder) {
      conversation.status = 'COD Confirmed';
    }

    await StoreService.updateWhatsAppConversation(storeId, conversation.id, conversation);

    // 14. Emit real-time WebSocket update for active store
    emitToStore(storeId, 'whatsapp:new_message', {
      storeId,
      conversationId: conversation.id,
      customerPhone: phone,
      customerMessage: userMsg,
      aiMessage: aiMsg,
      order: createdOrder,
    });

    return {
      success: true,
      reply: aiReply,
      voiceTranscription,
      conversation,
      matchedProducts,
      order: createdOrder,
    };
  },

  /**
   * 6. Generate AI Growth Suggestions with gpt-4o-mini based on real store multi-channel telemetry
   */
  async generateGrowthInsights(storeId) {
    const store = await StoreService.getStoreByIdWithoutUser(storeId);
    if (!store) throw new Error('Store not found.');

    const telemetry = await StoreService.getStoreMultiChannelTelemetry(storeId);
    const metrics = await StoreService.getStoreMetrics(storeId);
    const products = await StoreService.getStoreProducts(storeId);

    // Multi-tenant check: if store has zero data
    const totalOrders = telemetry.financials.total_orders;
    const grossRevenue = telemetry.financials.gross_revenue;
    const adSpend = telemetry.ads.reduce((sum, a) => sum + (Number(a.spend) || 0), 0);
    const hasData = telemetry.has_sufficient_data;

    if (!hasData) {
      return {
        hasSufficientData: false,
        summary: 'Not enough data yet. Connect your Shopify storefront, sync catalog, or launch your initial ad campaigns to activate AI multi-channel telemetry.',
        keyInsights: [
          'No completed orders or active ad telemetry recorded for this store tenant yet.',
          'Connect Shopify and WhatsApp Cloud API to automatically start populating real customer engagement metrics.',
        ],
        metrics: [
          { label: 'Blended ROAS', value: '0.00x', status: 'neutral', advice: 'Connect ad accounts (Meta / TikTok / Google) to track ad spend vs revenue.' },
          { label: 'Customer CAC', value: 'PKR 0', status: 'neutral', advice: 'Awaiting first cohort acquisition spend.' },
          { label: 'Courier Delivery Rate', value: '0%', status: 'neutral', advice: 'Enable COD courier integrations (PostEx, Trax) to monitor dispatch success.' },
          { label: 'WhatsApp Sales Rate', value: '0%', status: 'neutral', advice: 'Receive customer inquiries to measure conversational conversion.' },
        ],
        channels: telemetry,
        opportunities: [
          'Import your initial catalog from Shopify Admin to auto-generate AI product embeddings for customer WhatsApp inquiries.',
          'Configure WhatsApp Cloud API webhook to enable automated 24/7 AI conversational ordering.',
        ],
        risks: ['Zero sales telemetry available for predictive risk scoring.'],
        suggestions: [
          'Verify your Shopify domain in the Integrations tab.',
          'Send a test message in the WhatsApp AI Inquiries dialog to test customer response automation.',
        ],
      };
    }

    // Format Ad channels telemetry string for gpt-4o-mini
    const adsString = telemetry.ads
      .map(
        (a) =>
          `- ${a.platform}: Spend PKR ${a.spend.toLocaleString()} | Attributed Rev PKR ${a.revenue.toLocaleString()} | ROAS ${a.roas}x | CTR ${a.ctr}% | Conversions: ${a.conversions}`
      )
      .join('\n');

    // Format Courier channels telemetry string for gpt-4o-mini
    const couriersString = telemetry.couriers
      .map(
        (c) =>
          `- ${c.courier}: Dispatched ${c.dispatched} pkgs | Delivered ${c.delivered} | Delivery Rate ${c.delivery_success_rate}% | RTO Return ${c.rto_rate}% | COD Cash Collected PKR ${c.cod_collected.toLocaleString()}`
      )
      .join('\n');

    // Format WhatsApp conversational telemetry string
    const whatsappString = `- Total Inquiries Handled: ${telemetry.whatsapp.total_conversations} | Audio Voice Notes: ${telemetry.whatsapp.voice_notes} | WhatsApp Orders Booked: ${telemetry.whatsapp.orders_booked} | WhatsApp Revenue: PKR ${telemetry.whatsapp.revenue_generated.toLocaleString()} | Conversion Rate: ${telemetry.whatsapp.conversion_rate}%`;

    // We have real data: prompt gpt-4o-mini with comprehensive multi-channel telemetry
    const dataPrompt = `You are the Lead E-Commerce Growth Strategist & AI Data Scientist for "${store.name}".
Analyze the following REAL multi-channel store telemetry (Paid Ads, Courier Logistics, WhatsApp Conversational Sales, and Shopify Storefront) and return a structured JSON business intelligence report with actionable cross-channel suggestions.

MULTI-CHANNEL DATA:
1. STORE FINANCIALS:
- Store Name: ${store.name} (${store.domain})
- Total Gross Revenue: ${store.currency_symbol || 'PKR '}${Number(grossRevenue).toLocaleString()}
- Total Orders: ${totalOrders}
- Total Ad Spend: ${store.currency_symbol || 'PKR '}${Number(adSpend).toLocaleString()}
- Blended ROAS: ${adSpend > 0 ? (grossRevenue / adSpend).toFixed(2) + 'x' : 'Organic only'}
- Active Catalog Size: ${products.length} SKUs

2. PAID ADVERTISING CHANNELS (Meta, Google, TikTok, Snapchat):
${adsString}

3. COURIER LOGISTICS & COD CHANNELS (PostEx, Trax, Leopards, TCS):
${couriersString}

4. WHATSAPP AI SALES CONVERSATIONS:
${whatsappString}

OUTPUT REQUIREMENT:
Return ONLY valid JSON matching this exact structure:
{
  "hasSufficientData": true,
  "summary": "Executive summary of store performance across ads, couriers, and sales momentum (2-3 sentences).",
  "channelPerformance": [
    { "platform": "Meta Ads", "status": "scale|maintain|optimize", "recommendation": "Specific advice on scaling or adjusting spend." },
    { "platform": "Google Ads", "status": "scale|maintain|optimize", "recommendation": "Specific advice." },
    { "platform": "TikTok Ads", "status": "scale|maintain|optimize", "recommendation": "Specific advice." }
  ],
  "courierTelemetry": [
    { "courier": "PostEx Logistics", "rating": "Optimal|Watch|High RTO", "routingAdvice": "Clear logistics recommendation." },
    { "courier": "Trax Logistics", "rating": "Optimal|Watch|High RTO", "routingAdvice": "Clear logistics recommendation." }
  ],
  "keyInsights": [
    "Ground insight 1 with real numbers",
    "Ground insight 2 with real numbers",
    "Ground insight 3 with real numbers"
  ],
  "metrics": [
    { "label": "Blended ROAS", "value": "${adSpend > 0 ? (grossRevenue / adSpend).toFixed(2) + 'x' : 'Organic'}", "status": "good", "advice": "Ad spend efficiency analysis" },
    { "label": "Courier Delivery Success", "value": "${telemetry.couriers[0]?.delivery_success_rate || 90}%", "status": "good", "advice": "Logistics delivery analysis" },
    { "label": "WhatsApp Conversion", "value": "${telemetry.whatsapp.conversion_rate}%", "status": "good", "advice": "WhatsApp sales conversion analysis" },
    { "label": "Average Order Value", "value": "PKR ${totalOrders > 0 ? Math.round(grossRevenue / totalOrders).toLocaleString() : 0}", "status": "good", "advice": "Basket size analysis" }
  ],
  "opportunities": [
    "Cross-channel scaling opportunity (e.g. shift budget from underperforming ad channel to top winner)",
    "Fulfillment or WhatsApp conversion scaling opportunity"
  ],
  "risks": [
    "Specific identified risk (e.g. RTO return rate in specific couriers or ad creative fatigue)"
  ],
  "suggestions": [
    "Actionable step 1 for ad channels",
    "Actionable step 2 for courier routing",
    "Actionable step 3 for WhatsApp catalog conversion"
  ]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: dataPrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      parsed.channels = telemetry;

      // Persist generated insights in store_metrics
      await StoreService.updateStoreInsights(storeId, parsed);
      return parsed;
    } catch (err) {
      console.error('[AIService] generateGrowthInsights error:', err.message);
      return {
        hasSufficientData: true,
        summary: `Performance overview for ${store.name}: ${totalOrders} orders processed with ${store.currency_symbol || 'PKR '}${Number(grossRevenue).toLocaleString()} gross sales across all marketing and courier channels.`,
        keyInsights: [
          `Total of ${totalOrders} orders recorded across Shopify and WhatsApp channels.`,
          `Catalog features ${products.length} active SKUs ready for vector-powered AI customer matching.`,
        ],
        metrics: [
          { label: 'Gross Revenue', value: `${store.currency_symbol || 'PKR '}${Number(grossRevenue).toLocaleString()}`, status: 'good', advice: 'Maintain current velocity.' },
        ],
        channels: telemetry,
        opportunities: ['Scale top-performing categories via WhatsApp automated ordering.'],
        risks: ['Monitor inventory levels for high-velocity items.'],
      };
    }
  },
};

module.exports = AIService;

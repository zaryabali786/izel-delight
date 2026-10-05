const StoreService = require('../services/store.service');
const AIService = require('../services/ai.service');

const WhatsAppController = {
  /**
   * Get all conversations for a specific store
   */
  async getConversations(req, res) {
    try {
      const { storeId } = req.params;
      const conversations = await StoreService.getStoreWhatsAppConversations(storeId);
      return res.status(200).json({
        success: true,
        data: conversations,
      });
    } catch (err) {
      console.error('[WhatsAppController] getConversations error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Send customer text message & get real-time AI response (RAG grounded)
   */
  async sendMessage(req, res) {
    try {
      const { storeId } = req.params;
      const { customerPhone, customerName, message } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, message: 'Message text is required.' });
      }

      const result = await AIService.handleWhatsAppMessage({
        storeId,
        customerPhone: customerPhone || '+923008472910',
        customerName: customerName || 'Amina Tariq',
        messageText: message.trim(),
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      console.error('[WhatsAppController] sendMessage error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Handle WhatsApp Voice Message (Whisper STT -> Vector Search -> gpt-4o-mini)
   */
  async handleVoiceMessage(req, res) {
    try {
      const { storeId } = req.params;
      const { customerPhone, customerName } = req.body;

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ success: false, message: 'Audio file is required.' });
      }

      const result = await AIService.handleWhatsAppMessage({
        storeId,
        customerPhone: customerPhone || '+923008472910',
        customerName: customerName || 'Amina Tariq',
        audioBuffer: req.file.buffer,
        audioMimetype: req.file.mimetype || 'audio/ogg',
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      console.error('[WhatsAppController] handleVoiceMessage error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Create an Order directly via WhatsApp (COD or Online)
   */
  async createWhatsAppOrder(req, res) {
    try {
      const { storeId } = req.params;
      const {
        customer_name,
        customer_phone,
        address,
        city,
        postal_code,
        items,
        total_amount,
        payment_method,
        whatsapp_conversation_id,
      } = req.body;

      if (!customer_name || !address || !items || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Customer name, delivery address, and items are required.',
        });
      }

      const order = await StoreService.createStoreOrder(storeId, {
        channel: 'whatsapp',
        customer_name,
        customer_phone,
        address,
        city: city || 'Karachi',
        postal_code,
        items,
        total_amount: Number(total_amount) || 0,
        payment_method: payment_method || 'cod',
        payment_status: payment_method === 'online' ? 'paid' : 'pending',
        order_status: 'unfulfilled',
        whatsapp_conversation_id,
      });

      return res.status(201).json({
        success: true,
        message: 'Order created successfully from WhatsApp.',
        data: order,
      });
    } catch (err) {
      console.error('[WhatsAppController] createWhatsAppOrder error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Get store custom AI prompt
   */
  async getAiPrompt(req, res) {
    try {
      const { storeId } = req.params;
      const prompt = await StoreService.getStoreAIPrompt(storeId);
      return res.status(200).json({
        success: true,
        data: { prompt },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Update store custom AI prompt
   */
  async updateAiPrompt(req, res) {
    try {
      const { storeId } = req.params;
      const { prompt } = req.body;

      if (!prompt || !prompt.trim()) {
        return res.status(400).json({ success: false, message: 'AI prompt cannot be empty.' });
      }

      await StoreService.updateStoreAIPrompt(storeId, prompt.trim());
      return res.status(200).json({
        success: true,
        message: 'Store AI Prompt updated successfully.',
        data: { prompt: prompt.trim() },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Get WhatsApp orders for store
   */
  async getWhatsAppOrders(req, res) {
    try {
      const { storeId } = req.params;
      const orders = await StoreService.getStoreOrders(storeId, 'whatsapp');
      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Meta Cloud API Webhook Verification (GET)
   */
  verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'sellsphere_whatsapp_verify_token_2026';

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ [WhatsAppController] Meta Webhook verified successfully.');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  },

  /**
   * Meta Cloud API Incoming Messages Webhook (POST)
   */
  async handleMetaWebhook(req, res) {
    try {
      const body = req.body;
      if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0]?.value;
        const message = changes?.messages?.[0];
        const contact = changes?.contacts?.[0];
        const phoneNumberId = changes?.metadata?.phone_number_id;

        if (message && phoneNumberId) {
          const from = message.from;
          const customerName = contact?.profile?.name || 'WhatsApp Customer';

          // Find store associated with this phoneNumberId
          const db = require('../services/store.service').getStoreIntegrations; // or find store
          // Process message asynchronously
          console.log(`💬 [WhatsAppController] Incoming Meta message from ${from}:`, message.type);
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    } catch (err) {
      console.error('[WhatsAppController] Meta webhook error:', err.message);
      return res.status(200).send('EVENT_RECEIVED');
    }
  },
};

module.exports = WhatsAppController;

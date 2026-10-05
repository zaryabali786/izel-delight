const express = require('express');
const router = express.Router();
const multer = require('multer');
const WhatsAppController = require('../controllers/whatsapp.controller');
const { verifyAuth } = require('../middleware/auth.middleware');

// In-memory audio upload handler for WhatsApp voice notes (max 25MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ── Public Meta Cloud API Webhook Endpoints ─────────────────────────────────
router.get('/webhook', WhatsAppController.verifyWebhook);
router.post('/webhook', WhatsAppController.handleMetaWebhook);

// ── Protected Authenticated Store Endpoints ─────────────────────────────────
router.use(verifyAuth);

// Get real conversation history for current store
router.get('/:storeId/conversations', WhatsAppController.getConversations);

// Send text message (triggers vector search & gpt-4o-mini response)
router.post('/:storeId/message', WhatsAppController.sendMessage);

// Send voice message (Whisper transcription -> vector search -> gpt-4o-mini)
router.post('/:storeId/voice', upload.single('audio'), WhatsAppController.handleVoiceMessage);

// WhatsApp Ordering (create order from chat)
router.post('/:storeId/order', WhatsAppController.createWhatsAppOrder);
router.get('/:storeId/orders', WhatsAppController.getWhatsAppOrders);

// Store Custom AI Prompt
router.get('/:storeId/ai-prompt', WhatsAppController.getAiPrompt);
router.put('/:storeId/ai-prompt', WhatsAppController.updateAiPrompt);

module.exports = router;

const AIService = require('../services/ai.service');
const StoreService = require('../services/store.service');

const AIController = {
  /**
   * Generate or fetch real-time AI Growth Insights using gpt-4o-mini
   */
  async getGrowthInsights(req, res) {
    try {
      const { storeId } = req.params;
      const insights = await AIService.generateGrowthInsights(storeId);
      return res.status(200).json({
        success: true,
        data: insights,
      });
    } catch (err) {
      console.error('[AIController] getGrowthInsights error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Vector search products
   */
  async searchProducts(req, res) {
    try {
      const { storeId } = req.params;
      const { query, limit } = req.body;
      const products = await AIService.searchProducts(storeId, query || '', limit || 6);
      return res.status(200).json({
        success: true,
        data: products,
      });
    } catch (err) {
      console.error('[AIController] searchProducts error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Get store AI prompt
   */
  async getPrompt(req, res) {
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
   * Update store AI prompt
   */
  async updatePrompt(req, res) {
    try {
      const { storeId } = req.params;
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ success: false, message: 'Prompt is required.' });
      }
      await StoreService.updateStoreAIPrompt(storeId, prompt);
      return res.status(200).json({
        success: true,
        message: 'Store AI Prompt saved.',
        data: { prompt },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = AIController;

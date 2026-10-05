const StoreService = require('../services/store.service');

const OrdersController = {
  /**
   * Get all orders for a store (can filter by ?channel=shopify or ?channel=whatsapp)
   */
  async getOrders(req, res) {
    try {
      const { storeId } = req.params;
      const { channel } = req.query;

      const orders = await StoreService.getStoreOrders(storeId, channel || 'all');
      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (err) {
      console.error('[OrdersController] getOrders error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Create an order (COD or Online)
   */
  async createOrder(req, res) {
    try {
      const { storeId } = req.params;
      const order = await StoreService.createStoreOrder(storeId, req.body);
      return res.status(201).json({
        success: true,
        message: 'Order created successfully.',
        data: order,
      });
    } catch (err) {
      console.error('[OrdersController] createOrder error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * Update order status / courier tracking
   */
  async updateOrder(req, res) {
    try {
      const { storeId, orderId } = req.params;
      const updated = await StoreService.updateStoreOrder(storeId, orderId, req.body);
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }
      return res.status(200).json({
        success: true,
        message: 'Order updated successfully.',
        data: updated,
      });
    } catch (err) {
      console.error('[OrdersController] updateOrder error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = OrdersController;

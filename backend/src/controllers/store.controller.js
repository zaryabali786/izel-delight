const StoreService = require('../services/store.service');

/**
 * @desc    Get all stores for authenticated user
 * @route   GET /api/stores
 * @access  Private
 */
const getStores = async (req, res) => {
  try {
    const userId = req.user.id;
    const userMetadata = req.user.user_metadata || {};
    const stores = await StoreService.getUserStores(userId, userMetadata);

    return res.status(200).json({
      success: true,
      data: stores,
    });
  } catch (err) {
    console.error('[StoreController] getStores error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve stores.',
      error: err.message,
    });
  }
};

/**
 * @desc    Create a new store (isolated tenant)
 * @route   POST /api/stores
 * @access  Private
 * @body    { name, domain?, platform?, currency? }
 */
const createStore = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, domain, platform, currency } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Store name is required.',
      });
    }

    const store = await StoreService.createStore(userId, {
      name: name.trim(),
      domain: domain ? domain.trim() : undefined,
      platform: platform || 'Shopify',
      currency: currency || 'PKR',
    });

    return res.status(201).json({
      success: true,
      message: `Store "${store.name}" created successfully!`,
      data: store,
    });
  } catch (err) {
    console.error('[StoreController] createStore error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to create store.',
      error: err.message,
    });
  }
};

/**
 * @desc    Get specific store details
 * @route   GET /api/stores/:id
 * @access  Private
 */
const getStoreById = async (req, res) => {
  try {
    const userId = req.user.id;
    const storeId = req.params.id;

    const store = await StoreService.getStoreById(storeId, userId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found or unauthorized.',
      });
    }

    return res.status(200).json({
      success: true,
      data: store,
    });
  } catch (err) {
    console.error('[StoreController] getStoreById error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch store details.',
      error: err.message,
    });
  }
};

/**
 * @desc    Update store details
 * @route   PUT /api/stores/:id
 * @access  Private
 */
const updateStore = async (req, res) => {
  try {
    const userId = req.user.id;
    const storeId = req.params.id;
    const { name, domain, platform, currency, status, settings } = req.body;

    const updated = await StoreService.updateStore(storeId, userId, {
      name,
      domain,
      platform,
      currency,
      status,
      settings,
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Store not found or unauthorized.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Store updated successfully.',
      data: updated,
    });
  } catch (err) {
    console.error('[StoreController] updateStore error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update store.',
      error: err.message,
    });
  }
};

/**
 * @desc    Delete store
 * @route   DELETE /api/stores/:id
 * @access  Private
 */
const deleteStore = async (req, res) => {
  try {
    const userId = req.user.id;
    const storeId = req.params.id;

    await StoreService.deleteStore(storeId, userId);

    return res.status(200).json({
      success: true,
      message: 'Store and all associated data deleted successfully.',
    });
  } catch (err) {
    console.error('[StoreController] deleteStore error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete store.',
      error: err.message,
    });
  }
};

/**
 * @desc    Get store integrations
 * @route   GET /api/stores/:id/integrations
 * @access  Private
 */
const getIntegrations = async (req, res) => {
  try {
    const userId = req.user.id;
    const storeId = req.params.id;

    const list = await StoreService.getStoreIntegrations(storeId, userId);
    return res.status(200).json({
      success: true,
      data: list,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc    Update / save store integration
 * @route   POST /api/stores/:id/integrations
 * @access  Private
 */
const saveIntegration = async (req, res) => {
  try {
    const userId = req.user.id;
    const storeId = req.params.id;
    const { provider, config, status } = req.body;

    if (!provider) {
      return res.status(400).json({ success: false, message: 'Provider is required.' });
    }

    const saved = await StoreService.updateStoreIntegration(
      storeId,
      userId,
      provider,
      config || {},
      status || 'connected'
    );

    return res.status(200).json({
      success: true,
      message: `Integration "${provider}" saved successfully.`,
      data: saved,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc    Get store catalog products
 * @route   GET /api/stores/:id/catalog
 * @access  Private
 */
const getCatalog = async (req, res) => {
  try {
    const storeId = req.params.id;
    const products = await StoreService.getStoreProducts(storeId);
    return res.status(200).json({
      success: true,
      data: products,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc    Add product to store catalog
 * @route   POST /api/stores/:id/catalog
 * @access  Private
 */
const addProduct = async (req, res) => {
  try {
    const storeId = req.params.id;
    const { title, sku, price, compare_at_price, stock, vendor, category, image_url } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'Product title is required.' });
    }

    const product = await StoreService.addStoreProduct(storeId, {
      title,
      sku,
      price,
      compare_at_price,
      stock,
      vendor,
      category,
      image_url,
    });

    return res.status(201).json({
      success: true,
      message: 'Product added successfully.',
      data: product,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc    Delete product from store catalog
 * @route   DELETE /api/stores/:id/catalog/:productId
 * @access  Private
 */
const deleteProduct = async (req, res) => {
  try {
    const { id: storeId, productId } = req.params;
    await StoreService.deleteStoreProduct(storeId, productId);
    return res.status(200).json({
      success: true,
      message: 'Product removed from catalog.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc    Get store analytics & financial metrics
 * @route   GET /api/stores/:id/metrics
 * @access  Private
 */
const getMetrics = async (req, res) => {
  try {
    const storeId = req.params.id;
    const metrics = await StoreService.getStoreMetrics(storeId);
    return res.status(200).json({
      success: true,
      data: metrics,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getStores,
  createStore,
  getStoreById,
  updateStore,
  deleteStore,
  getIntegrations,
  saveIntegration,
  getCatalog,
  addProduct,
  deleteProduct,
  getMetrics,
};

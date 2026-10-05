const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { cacheRoute, invalidateStoreCache } = require('../middleware/cache.middleware');

const {
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
} = require('../controllers/store.controller');

// All store routes require valid Supabase JWT authentication
router.use(authMiddleware);

// ── Store Tenancy Endpoints ─────────────────────────────────────
router.get('/', cacheRoute(120, 'stores-list'), getStores);
router.post('/', invalidateStoreCache, createStore);
router.get('/:id', cacheRoute(300, 'store-detail'), getStoreById);
router.put('/:id', invalidateStoreCache, updateStore);
router.delete('/:id', invalidateStoreCache, deleteStore);

// ── Store Integrations ──────────────────────────────────────────
router.get('/:id/integrations', cacheRoute(300, 'store-integrations'), getIntegrations);
router.post('/:id/integrations', invalidateStoreCache, saveIntegration);

// ── Store Catalog / Products ────────────────────────────────────
router.get('/:id/catalog', cacheRoute(180, 'store-catalog'), getCatalog);
router.post('/:id/catalog', invalidateStoreCache, addProduct);
router.delete('/:id/catalog/:productId', invalidateStoreCache, deleteProduct);

// ── Store Metrics & P&L (1 min TTL for high freshness + massive query offloading) ─
router.get('/:id/metrics', cacheRoute(60, 'store-metrics'), getMetrics);

module.exports = router;

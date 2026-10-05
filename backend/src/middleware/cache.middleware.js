const { CacheService } = require('../config/redis');

/**
 * Route-level Redis Cache Middleware
 *
 * @param {number} ttlSeconds - Time-to-live for cached response in seconds (default 300s = 5m)
 * @param {string} [prefix] - Optional custom key prefix (e.g. 'catalog', 'metrics')
 */
const cacheRoute = (ttlSeconds = 300, prefix = 'api') => {
  return async (req, res, next) => {
    // Only cache safe GET requests
    if (req.method !== 'GET') {
      return next();
    }

    if (!CacheService.isEnabled()) {
      res.setHeader('X-Cache', 'BYPASS');
      return next();
    }

    const userId = req.user?.id || 'anon';
    const storeId = req.params.id || 'global';
    const cacheKey = `cache:${prefix}:user:${userId}:store:${storeId}:${req.originalUrl}`;

    try {
      const cachedData = await CacheService.get(cacheKey);

      if (cachedData !== null && cachedData !== undefined) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Key', cacheKey);
        return res.status(200).json(cachedData);
      }

      // Cache MISS: Intercept res.json to cache the successful response
      res.setHeader('X-Cache', 'MISS');

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // Only cache successful 200 responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          CacheService.set(cacheKey, body, ttlSeconds).catch((err) => {
            console.warn('[CacheMiddleware] Failed to write cache:', err.message);
          });
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      console.warn('[CacheMiddleware] Read error, bypassing cache:', err.message);
      res.setHeader('X-Cache', 'ERROR');
      next();
    }
  };
};

/**
 * Middleware to auto-purge cache for active store when mutation occurs
 */
const invalidateStoreCache = async (req, res, next) => {
  const storeId = req.params.id;
  const userId = req.user?.id;

  // Run next handler first
  const originalJson = res.json.bind(res);
  res.json = async (body) => {
    // If mutation succeeded, invalidate store cache
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        if (storeId) {
          await CacheService.invalidateStore(storeId);
        }
        if (userId) {
          await CacheService.invalidateUser(userId);
        }
      } catch (err) {
        console.warn('[CacheMiddleware] Invalidation warning:', err.message);
      }
    }
    return originalJson(body);
  };

  next();
};

module.exports = { cacheRoute, invalidateStoreCache, CacheService };

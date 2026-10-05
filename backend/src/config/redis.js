const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';
const DEFAULT_TTL = parseInt(process.env.CACHE_DEFAULT_TTL, 10) || 300; // 5 mins

let isConnected = false;
let redis = null;

// ── In-Memory Fallback Cache (Active when Redis server is offline) ────────────
const memoryStore = new Map();

function memGet(key) {
  const item = memoryStore.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return item.value;
}

function memSet(key, value, ttlSeconds = DEFAULT_TTL) {
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function memDel(key) {
  memoryStore.delete(key);
}

function memDelPattern(pattern) {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  for (const k of memoryStore.keys()) {
    if (regex.test(k)) {
      memoryStore.delete(k);
    }
  }
}

// ── Redis Connection Initialization ──────────────────────────────────────────

try {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    enableOfflineQueue: false,
    retryStrategy(times) {
      if (times > 3) {
        return null; // Stop retrying after 3 attempts, fallback to memory
      }
      return Math.min(times * 200, 1000);
    },
  });

  redis.on('connect', () => {
    isConnected = true;
    console.log('⚡  Redis Cache  : Connected to', REDIS_URL);
  });

  redis.on('ready', () => {
    isConnected = true;
  });

  redis.on('error', (err) => {
    if (isConnected) {
      console.warn('⚠️  Redis Cache  : Connection lost, using in-memory cache.');
    }
    isConnected = false;
  });

  redis.on('close', () => {
    isConnected = false;
  });
} catch (err) {
  console.warn('⚠️  Redis Client : Initialization error, using in-memory cache:', err.message);
  isConnected = false;
}

// ── Unified Cache Service ───────────────────────────────────────────────────

const CacheService = {
  /**
   * Check if cache is globally enabled and whether Redis is live
   */
  isEnabled() {
    return CACHE_ENABLED;
  },

  isRedisLive() {
    return isConnected;
  },

  /**
   * Get parsed cached value
   */
  async get(key) {
    if (!CACHE_ENABLED) return null;

    if (isConnected && redis) {
      try {
        const raw = await redis.get(key);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      } catch (err) {
        // Fallback to memory
        return memGet(key);
      }
    }

    return memGet(key);
  },

  /**
   * Set cached value with TTL in seconds
   */
  async set(key, value, ttlSeconds = DEFAULT_TTL) {
    if (!CACHE_ENABLED) return false;

    const payload = typeof value === 'object' ? JSON.stringify(value) : String(value);

    if (isConnected && redis) {
      try {
        await redis.set(key, payload, 'EX', ttlSeconds);
        return true;
      } catch (err) {
        memSet(key, value, ttlSeconds);
        return true;
      }
    }

    memSet(key, value, ttlSeconds);
    return true;
  },

  /**
   * Delete a specific cache key
   */
  async del(key) {
    if (isConnected && redis) {
      try {
        await redis.del(key);
      } catch (_) {}
    }
    memDel(key);
    return true;
  },

  /**
   * Invalidate all keys matching a wildcard pattern (e.g. "store:123:*")
   */
  async delPattern(pattern) {
    if (isConnected && redis) {
      try {
        const stream = redis.scanStream({ match: pattern, count: 100 });
        stream.on('data', async (keys) => {
          if (keys && keys.length) {
            const pipeline = redis.pipeline();
            keys.forEach((k) => pipeline.del(k));
            await pipeline.exec();
          }
        });
      } catch (_) {}
    }
    memDelPattern(pattern);
    return true;
  },

  /**
   * Invalidate tenant/store specific cache
   */
  async invalidateStore(storeId) {
    const pattern = `*store:${storeId}:*`;
    await this.delPattern(pattern);
  },

  /**
   * Invalidate user specific cache
   */
  async invalidateUser(userId) {
    const pattern = `*user:${userId}:*`;
    await this.delPattern(pattern);
  },

  /**
   * Flush all cache entries
   */
  async flushAll() {
    if (isConnected && redis) {
      try {
        await redis.flushdb();
      } catch (_) {}
    }
    memoryStore.clear();
    return true;
  },
};

module.exports = { redis, CacheService };

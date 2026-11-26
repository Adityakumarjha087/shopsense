import { Redis } from "ioredis";
import { logger } from "./logger.js";

/** Minimal cache abstraction: Redis in prod, in-memory map for tests/local fallbacks. */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(pattern: string): Promise<void>;
  ping(): Promise<boolean>;
}

export class MemoryCache implements Cache {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get<T>(key: string): Promise<T | undefined> {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return JSON.parse(hit.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** Deletes keys matching a glob with a trailing `*` (prefix match) or an exact key. */
  async del(pattern: string): Promise<void> {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      for (const key of this.store.keys()) if (key.startsWith(prefix)) this.store.delete(key);
    } else {
      this.store.delete(pattern);
    }
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

export class RedisCache implements Cache {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch (err) {
      logger.warn({ err }, "cache get failed");
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      logger.warn({ err }, "cache set failed");
    }
  }

  async del(pattern: string): Promise<void> {
    try {
      if (!pattern.includes("*")) {
        await this.redis.del(pattern);
        return;
      }
      let cursor = "0";
      do {
        const [next, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== "0");
    } catch (err) {
      logger.warn({ err }, "cache del failed");
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}

export function createCache(redisUrl: string | undefined): Cache {
  if (!redisUrl) return new MemoryCache();
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  redis.on("error", (err) => logger.warn({ err: err.message }, "redis error"));
  return new RedisCache(redis);
}

/** Read-through helper. */
export async function cached<T>(cache: Cache, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  await cache.set(key, value, ttlSeconds);
  return value;
}

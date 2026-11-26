import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { cached, MemoryCache, RedisCache, createCache } from "../../src/lib/cache.js";
import { optionalAuth, requireAuth, requireInternal, requireRole, signAccessToken, verifyAccessToken } from "../../src/middleware/auth.js";
import { AppError } from "../../src/lib/errors.js";
import jwt from "jsonwebtoken";
import { env } from "../../src/config/env.js";

describe("MemoryCache", () => {
  it("stores, expires and deletes by prefix", async () => {
    const c = new MemoryCache();
    await c.set("a:1", { v: 1 }, 60);
    await c.set("a:2", 2, 60);
    await c.set("b:1", 3, 60);
    expect(await c.get("a:1")).toEqual({ v: 1 });
    await c.del("a:*");
    expect(await c.get("a:2")).toBeUndefined();
    expect(await c.get("b:1")).toBe(3);
    await c.del("b:1");
    expect(await c.get("b:1")).toBeUndefined();
    await c.set("short", 1, -1);
    expect(await c.get("short")).toBeUndefined();
    expect(await c.ping()).toBe(true);
  });

  it("read-through caches loader results", async () => {
    const c = new MemoryCache();
    const load = vi.fn(async () => 42);
    expect(await cached(c, "k", 60, load)).toBe(42);
    expect(await cached(c, "k", 60, load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("RedisCache", () => {
  it("degrades gracefully when redis errors", async () => {
    const broken = {
      get: async () => {
        throw new Error("down");
      },
      set: async () => {
        throw new Error("down");
      },
      del: async () => {
        throw new Error("down");
      },
      scan: async () => {
        throw new Error("down");
      },
      ping: async () => {
        throw new Error("down");
      },
    };
    const c = new RedisCache(broken as never);
    expect(await c.get("x")).toBeUndefined();
    await expect(c.set("x", 1, 1)).resolves.toBeUndefined();
    await expect(c.del("x*")).resolves.toBeUndefined();
    await expect(c.del("x")).resolves.toBeUndefined();
    expect(await c.ping()).toBe(false);
  });

  it("uses SCAN for pattern deletes", async () => {
    const deleted: string[] = [];
    const fake = {
      get: async () => JSON.stringify({ a: 1 }),
      set: async () => "OK",
      scan: vi.fn().mockResolvedValueOnce(["5", ["k1"]]).mockResolvedValueOnce(["0", ["k2"]]),
      del: async (...keys: string[]) => {
        deleted.push(...keys);
        return keys.length;
      },
      ping: async () => "PONG",
    };
    const c = new RedisCache(fake as never);
    expect(await c.get("x")).toEqual({ a: 1 });
    await c.del("k*");
    expect(deleted).toEqual(["k1", "k2"]);
    expect(await c.ping()).toBe(true);
  });

  it("createCache without URL returns memory cache", () => {
    expect(createCache(undefined)).toBeInstanceOf(MemoryCache);
  });
});

const run = (mw: (req: Request, res: Response, next: NextFunction) => void, req: Partial<Request>) => {
  let err: unknown = "not-called";
  mw(req as Request, {} as Response, (e?: unknown) => {
    err = e;
  });
  return err;
};

describe("auth middleware", () => {
  const user = { id: "u1", email: "a@b.co", role: "ADMIN" as const };

  it("signs and verifies access tokens", () => {
    expect(verifyAccessToken(signAccessToken(user))).toEqual(user);
    const wrongType = jwt.sign({ sub: "u", typ: "refresh" }, env.JWT_ACCESS_SECRET, { issuer: "shopsense" });
    expect(() => verifyAccessToken(wrongType)).toThrow(AppError);
  });

  it("optionalAuth sets req.user only for valid tokens", () => {
    const req: Partial<Request> = { headers: { authorization: `Bearer ${signAccessToken(user)}` } };
    run(optionalAuth, req);
    expect(req.user).toEqual(user);
    const bad: Partial<Request> = { headers: { authorization: "Bearer nope" } };
    run(optionalAuth, bad);
    expect(bad.user).toBeUndefined();
  });

  it("requireAuth / requireRole / requireInternal reject appropriately", () => {
    expect((run(requireAuth, { headers: {} }) as AppError).status).toBe(401);
    expect((run(requireAuth, { headers: { authorization: "Bearer x" } }) as AppError).message).toMatch(/Invalid or expired/);
    expect(run(requireAuth, { headers: {}, user })).toBeUndefined();
    expect((run(requireRole("ADMIN"), { user: { ...user, role: "CUSTOMER" } }) as AppError).status).toBe(403);
    expect(run(requireRole("ADMIN"), { user })).toBeUndefined();
    expect((run(requireInternal, { headers: { "x-internal-key": "wrong" } }) as AppError).status).toBe(401);
    expect(run(requireInternal, { headers: { "x-internal-key": env.INTERNAL_API_KEY } })).toBeUndefined();
  });
});

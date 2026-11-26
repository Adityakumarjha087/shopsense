import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/context.js";
import { MemoryCache } from "../src/lib/cache.js";
import { prisma } from "../src/lib/prisma.js";
import { FakeLlmProvider } from "../src/modules/llm/fake.provider.js";
import type { LlmProvider } from "../src/modules/llm/types.js";
import { StripeGateway } from "../src/modules/payments/gateway.js";
import type { MlClient, RecStrategy } from "../src/modules/recommendations/ml-client.js";
import { MlUnavailableError } from "../src/modules/recommendations/ml-client.js";
import { DbSearchEngine } from "../src/modules/search/db-engine.js";
import { seed, DEMO_ADMIN, DEMO_CUSTOMER } from "../src/seed/index.js";

export { prisma, DEMO_ADMIN, DEMO_CUSTOMER };

/** Deterministic in-memory ML stand-in; can be switched to "down" to exercise fallbacks. */
export class StubMlClient implements MlClient {
  down = false;
  calls: Array<{ method: string; args: unknown }> = [];
  constructor(private readonly productIds: () => Promise<string[]>) {}
  private guard(method: string, args: unknown) {
    this.calls.push({ method, args });
    if (this.down) throw new MlUnavailableError("stub down");
  }
  async recommendForUser(args: { userId?: string; recent: string[]; k: number; strategy: RecStrategy; exclude: string[] }) {
    this.guard("recommendForUser", args);
    const ids = (await this.productIds()).filter((id) => !args.exclude.includes(id)).slice(0, args.k);
    return { items: ids.map((productId, i) => ({ productId, score: 1 - i / 100 })), strategy: args.userId ? args.strategy : "popularity", fallback: !args.userId };
  }
  async similar(productId: string, k: number) {
    this.guard("similar", { productId, k });
    return (await this.productIds()).filter((id) => id !== productId).slice(0, k).map((productId, i) => ({ productId, score: 0.9 - i / 100 }));
  }
  async boughtTogether(productId: string, k: number) {
    this.guard("boughtTogether", { productId, k });
    const ids = (await this.productIds()).filter((id) => id !== productId).slice(0, k);
    return { items: ids.map((p) => ({ productId: p, confidence: 0.4, lift: 3.2, support: 0.01 })), source: "rules" };
  }
  async popular(k: number) {
    this.guard("popular", { k });
    return (await this.productIds()).slice(0, k).map((productId) => ({ productId, score: 1 }));
  }
  async semanticSearch(query: string, k: number) {
    this.guard("semanticSearch", { query, k });
    const rows = await prisma.product.findMany({
      where: { OR: query.split(/\s+/).map((w) => ({ description: { contains: w, mode: "insensitive" as const } })) },
      select: { id: true },
      take: k,
    });
    return rows.map((r, i) => ({ productId: r.id, score: 0.8 - i / 1000 }));
  }
  async modelInfo() {
    this.guard("modelInfo", {});
    return { version: "stub", metrics: { als: { precision_at_k: 0.1 } } };
  }
  async train() {
    this.guard("train", {});
    return { version: "stub-2" };
  }
  async refreshIndex() {
    this.guard("refreshIndex", {});
  }
  async health() {
    return !this.down;
  }
}

export interface TestHarness {
  app: Express;
  ctx: AppContext;
  ml: StubMlClient;
  catalogChanges: string[][];
}

export function buildHarness(overrides: Partial<AppContext> = {}): TestHarness {
  const ml = new StubMlClient(async () =>
    (await prisma.product.findMany({ where: { isActive: true }, orderBy: [{ ratingCount: "desc" }, { id: "asc" }], select: { id: true }, take: 50 })).map((p) => p.id),
  );
  const catalogChanges: string[][] = [];
  const cache = new MemoryCache();
  const ctx: AppContext = {
    prisma,
    cache,
    ml,
    search: new DbSearchEngine(prisma),
    llm: new FakeLlmProvider() as LlmProvider,
    payments: new StripeGateway(undefined, "whsec_test_secret"),
    onCatalogChange: async (ids) => {
      catalogChanges.push(ids);
      await cache.del("catalog:*");
      await cache.del("search:*");
    },
    ...overrides,
  };
  return { app: createApp(ctx), ctx, ml, catalogChanges };
}

let seeded = false;
/** Seeds a small deterministic dataset once per test file process. */
export async function ensureSeeded() {
  if (seeded) return;
  await seed(prisma, { perKind: 2, users: 25, seed: 7 });
  seeded = true;
}

export async function login(app: Express, email: string, password: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { accessToken: string; refreshToken: string; user: { id: string; role: string } };
}

export const SHIPPING = {
  fullName: "Test Shopper",
  line1: "42 Residency Road",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560025",
  phone: "9876543210",
};

/** Returns an in-stock variant (with at least `min` units) of an active product. */
export async function inStockVariant(min = 3) {
  return prisma.productVariant.findFirstOrThrow({ where: { stock: { gte: min }, product: { isActive: true } }, include: { product: true }, orderBy: { sku: "asc" } });
}

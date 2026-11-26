import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { buildHarness, DEMO_CUSTOMER, ensureSeeded, login, prisma } from "../helpers.js";
import type { LlmProvider } from "../../src/modules/llm/types.js";
import { LlmError } from "../../src/modules/llm/types.js";

const h = buildHarness();
const { app } = h;
let token = "";

describe("recommendations", () => {
  beforeAll(async () => {
    await ensureSeeded();
    token = (await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password)).accessToken;
  });

  it("serves personalised recs with an A/B variant and logs impressions", async () => {
    const res = await request(app).get("/api/v1/recommendations/for-you").query({ k: 6 }).set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(6);
    expect(["A", "B"]).toContain(res.body.variant);
    expect(res.body.fallback).toBe(false);
    const call = h.ml.calls.filter((c) => c.method === "recommendForUser").at(-1)!.args as { userId: string; recent: string[] };
    expect(call.userId).toBeTruthy();
    expect(call.recent.length).toBeGreaterThan(0);
    const impression = await prisma.recommendationEvent.findFirstOrThrow({ where: { requestId: res.body.requestId } });
    expect(impression).toMatchObject({ kind: "impression", itemCount: 6, variant: res.body.variant });

    const productId = res.body.items[0].id as string;
    const click = await request(app).post("/api/v1/recommendations/click").send({ requestId: res.body.requestId, productId });
    expect(click.body.recorded).toBe(true);
    await request(app).post("/api/v1/recommendations/click").send({ requestId: res.body.requestId, productId });
    expect(await prisma.recommendationEvent.count({ where: { requestId: res.body.requestId, kind: "click" } })).toBe(1);
    const unknown = await request(app).post("/api/v1/recommendations/click").send({ requestId: "00000000-0000-4000-8000-000000000000", productId });
    expect(unknown.body.recorded).toBe(false);

    const admin = await login(app, "admin@shopsense.dev", "Admin@12345");
    const stats = await request(app).get("/api/v1/admin/experiments").set("authorization", `Bearer ${admin.accessToken}`);
    const variant = stats.body.variants.find((v: { variant: string }) => v.variant === res.body.variant);
    expect(variant.clicks).toBeGreaterThanOrEqual(1);
    expect(variant.ctr).toBeGreaterThan(0);
  });

  it("falls back to database popularity when the ML service is down (cold start)", async () => {
    h.ml.down = true;
    try {
      const res = await request(app).get("/api/v1/recommendations/for-you").set("x-session-id", "brand-new-session-1").query({ k: 4 });
      expect(res.body).toMatchObject({ strategy: "popularity_db", fallback: true });
      expect(res.body.items).toHaveLength(4);
      const p = res.body.items[0].id as string;
      const similar = await request(app).get(`/api/v1/recommendations/similar/${p}`);
      expect(similar.body).toMatchObject({ strategy: "category_popularity", fallback: true });
      expect(similar.body.items.every((i: { id: string }) => i.id !== p)).toBe(true);
      const fbt = await request(app).get(`/api/v1/recommendations/bought-together/${p}`);
      expect(fbt.body).toMatchObject({ strategy: "co_purchase_sql", fallback: true });
    } finally {
      h.ml.down = false;
    }
  });

  it("serves similar items and frequently-bought-together from the ML service", async () => {
    const p = await prisma.product.findFirstOrThrow({ where: { isActive: true }, orderBy: { slug: "desc" } });
    const similar = await request(app).get(`/api/v1/recommendations/similar/${p.slug}`).query({ k: 3 });
    expect(similar.body).toMatchObject({ strategy: "content_embedding", fallback: false });
    expect(similar.body.items).toHaveLength(3);
    const fbt = await request(app).get(`/api/v1/recommendations/bought-together/${p.id}`).query({ k: 2 });
    expect(fbt.body.strategy).toBe("association_rules");
    expect(fbt.body.rules[0]).toMatchObject({ confidence: 0.4, lift: 3.2 });
    expect((await request(app).get("/api/v1/recommendations/similar/missing")).status).toBe(404);
  });
});

describe("assistant", () => {
  beforeAll(ensureSeeded);

  it("searches, then compares and adds to cart across turns", async () => {
    const first = await request(app).post("/api/v1/assistant/chat").send({ messages: [{ role: "user", content: "warm winter jacket under 9000" }] });
    expect(first.status).toBe(200);
    expect(first.body.toolCalls[0].name).toBe("search_products");
    expect(first.body.products.length).toBeGreaterThan(1);
    expect(first.body.provider).toBe("fake:shopsense-fake-1");
    const shown = first.body.products.slice(0, 3).map((p: { id: string; slug: string; name: string; price: number }) => ({ id: p.id, slug: p.slug, name: p.name, price: p.price }));

    const compare = await request(app)
      .post("/api/v1/assistant/chat")
      .send({ messages: [{ role: "user", content: "warm winter jacket" }, { role: "assistant", content: first.body.reply }, { role: "user", content: "compare the first two" }], shownProducts: shown });
    expect(compare.body.toolCalls[0].name).toBe("compare_products");
    expect(compare.body.comparison).toHaveLength(2);
    expect(compare.body.reply).toMatch(/compare/);

    const stock = await request(app).post("/api/v1/assistant/chat").send({ messages: [{ role: "user", content: "is the first one in stock?" }], shownProducts: shown });
    expect(stock.body.toolCalls[0].name).toBe("check_stock");

    const details = await request(app).post("/api/v1/assistant/chat").send({ messages: [{ role: "user", content: "tell me more about the second" }], shownProducts: shown });
    expect(details.body.toolCalls[0].name).toBe("get_product_details");

    const guestAdd = await request(app).post("/api/v1/assistant/chat").send({ messages: [{ role: "user", content: "add the first one to my cart" }], shownProducts: shown });
    expect(guestAdd.body.toolCalls[0].name).toBe("add_to_cart");
    if (guestAdd.body.cartActions.length) expect(guestAdd.body.cartActions[0].persisted).toBe(false);

    const tok = (await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password)).accessToken;
    await request(app).delete("/api/v1/cart").set("authorization", `Bearer ${tok}`);
    const inStock = await prisma.product.findFirstOrThrow({ where: { isActive: true, variants: { some: { stock: { gte: 3 } } } }, include: { variants: true } });
    const add = await request(app)
      .post("/api/v1/assistant/chat")
      .set("authorization", `Bearer ${tok}`)
      .send({ messages: [{ role: "user", content: "add it to my cart" }], shownProducts: [{ id: inStock.id, slug: inStock.slug, name: inStock.name, price: inStock.basePrice }] });
    expect(add.body.cartActions[0]).toMatchObject({ productId: inStock.id, persisted: true });
    expect((await request(app).get("/api/v1/cart").set("authorization", `Bearer ${tok}`)).body.itemCount).toBe(1);
  });

  it("returns tool errors to the model instead of failing", async () => {
    const res = await request(app).post("/api/v1/assistant/chat").send({ messages: [{ role: "user", content: "compare both" }], shownProducts: [{ id: "nope-1", slug: "x", name: "X", price: 1 }, { id: "nope-2", slug: "y", name: "Y", price: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.toolCalls[0].isError).toBe(true);
    expect(res.body.reply).toMatch(/problem/);
  });

  it("validates input and maps provider outages to 503", async () => {
    expect((await request(app).post("/api/v1/assistant/chat").send({ messages: [{ role: "assistant", content: "hi" }] })).status).toBe(400);
    const failing: LlmProvider = {
      name: "openai",
      model: "x",
      chat: async () => {
        throw new LlmError("down", "openai", true);
      },
    };
    const refusing: LlmProvider = { name: "anthropic", model: "claude-opus-5-5", chat: async () => ({ content: "", toolCalls: [], stopReason: "refusal" }) };
    const down = buildHarness({ llm: failing });
    expect((await request(down.app).post("/api/v1/assistant/chat").send({ messages: [{ role: "user", content: "hi" }] })).status).toBe(503);
    const refused = await request(buildHarness({ llm: refusing }).app).post("/api/v1/assistant/chat").send({ messages: [{ role: "user", content: "hi" }] });
    expect(refused.body.reply).toMatch(/can't help/);
  });
});

import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { buildHarness, ensureSeeded, prisma } from "../helpers.js";

const { app, ml } = buildHarness();

describe("catalogue", () => {
  beforeAll(ensureSeeded);

  it("lists categories with counts", async () => {
    const res = await request(app).get("/api/v1/categories");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(10);
    expect(res.body[0]).toHaveProperty("productCount");
  });

  it("paginates, filters and sorts products", async () => {
    const res = await request(app).get("/api/v1/products").query({ category: "footwear", sort: "price_asc", pageSize: 5 });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
    expect(res.body.items.every((p: { category: { slug: string } }) => p.category.slug === "footwear")).toBe(true);
    const prices = res.body.items.map((p: { price: number }) => p.price);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
    for (const sort of ["price_desc", "rating", "newest", "popular"]) {
      expect((await request(app).get("/api/v1/products").query({ sort, maxPrice: 300000, minPrice: 100 })).status).toBe(200);
    }
    expect((await request(app).get("/api/v1/products").query({ sort: "bogus" })).status).toBe(400);
  });

  it("returns product detail by slug or id and 404s for unknown", async () => {
    const p = await prisma.product.findFirstOrThrow({ where: { isActive: true } });
    const bySlug = await request(app).get(`/api/v1/products/${p.slug}`);
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.variants.length).toBeGreaterThan(0);
    expect(bySlug.body.images.length).toBe(2);
    expect((await request(app).get(`/api/v1/products/${p.id}`)).body.slug).toBe(p.slug);
    expect((await request(app).get("/api/v1/products/does-not-exist")).status).toBe(404);
    const slugs = await request(app).get("/api/v1/products-slugs").query({ limit: 3 });
    expect(slugs.body.slugs).toHaveLength(3);
  });
});

describe("search", () => {
  beforeAll(ensureSeeded);

  it("combines keyword and semantic results with NL price parsing", async () => {
    const res = await request(app).get("/api/v1/search").query({ q: "warm winter under ₹5000" });
    expect(res.status).toBe(200);
    expect(res.body.parsed).toMatchObject({ text: "warm winter", maxPrice: 500000 });
    expect(res.body.engines.semantic).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((p: { price: number }) => p.price <= 500000)).toBe(true);
  });

  it("applies explicit filters and sorting", async () => {
    const res = await request(app).get("/api/v1/search").query({ q: "shoes", category: "footwear", sort: "price_desc", inStock: "true", minRating: 1 });
    expect(res.status).toBe(200);
    const prices = res.body.items.map((p: { price: number }) => p.price);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => b - a));
    expect(res.body.items.every((p: { category: { slug: string } }) => p.category.slug === "footwear")).toBe(true);
    expect((await request(app).get("/api/v1/search").query({ q: "mug", sort: "newest" })).status).toBe(200);
    expect((await request(app).get("/api/v1/search").query({ q: "mug", sort: "rating" })).status).toBe(200);
  });

  it("still answers when the ML service is down", async () => {
    ml.down = true;
    try {
      const res = await request(app).get("/api/v1/search").query({ q: "sweater" });
      expect(res.status).toBe(200);
      expect(res.body.engines.semantic).toBe(false);
    } finally {
      ml.down = false;
    }
  });

  it("autocompletes", async () => {
    const res = await request(app).get("/api/v1/search/suggest").query({ q: "Sweat" });
    expect(res.status).toBe(200);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect((await request(app).get("/api/v1/search/suggest")).status).toBe(400);
  });
});

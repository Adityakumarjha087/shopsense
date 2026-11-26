import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, HybridSearchService } from "../../src/modules/search/hybrid.service.js";
import { diversify } from "../../src/modules/search/search.routes.js";
import { toMeiliFilter } from "../../src/modules/search/meili-engine.js";
import type { SearchEngine } from "../../src/modules/search/engine.js";
import type { MlClient } from "../../src/modules/recommendations/ml-client.js";
import type { ProductCard } from "../../src/modules/catalog/catalog.service.js";

describe("reciprocalRankFusion", () => {
  it("rewards items present in both lists and records sources", () => {
    const hits = reciprocalRankFusion([
      { ids: ["a", "b", "c"], weight: 1, source: "keyword" },
      { ids: ["c", "d"], weight: 1, source: "semantic" },
    ]);
    expect(hits[0]!.id).toBe("c");
    expect(hits[0]!.sources).toEqual(["keyword", "semantic"]);
    expect(new Set(hits.map((h) => h.id))).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("applies weights", () => {
    const hits = reciprocalRankFusion([
      { ids: ["k"], weight: 1, source: "keyword" },
      { ids: ["s"], weight: 3, source: "semantic" },
    ]);
    expect(hits[0]!.id).toBe("s");
  });
});

const card = (id: string, cat: string): ProductCard => ({
  id,
  slug: id,
  name: id,
  brand: "b",
  price: 100,
  currency: "INR",
  image: null,
  ratingAvg: 4,
  ratingCount: 1,
  category: { slug: cat, name: cat },
  inStock: true,
  colors: [],
});

describe("diversify", () => {
  it("interleaves categories when scores are close", () => {
    const cards = [card("a1", "a"), card("a2", "a"), card("a3", "a"), card("b1", "b")];
    const scores = new Map([
      ["a1", 1],
      ["a2", 0.95],
      ["a3", 0.9],
      ["b1", 0.85],
    ]);
    expect(diversify(cards, scores, 0.75).map((c) => c.id)).toEqual(["a1", "b1", "a2", "a3"]);
  });
});

describe("toMeiliFilter", () => {
  it("builds escaped filter expressions", () => {
    expect(
      toMeiliFilter({ categories: ["footwear"], brands: ['Mira "M"'], minPrice: 100, maxPrice: 500, minRating: 4, inStock: true, colors: ["Black"] }, ["x"]),
    ).toEqual([
      'category IN ["footwear"]',
      'brand IN ["Mira \\"M\\""]',
      'colors IN ["Black"]',
      "price >= 100",
      "price <= 500",
      "ratingAvg >= 4",
      "inStock = true",
      'id IN ["x"]',
    ]);
  });
});

describe("HybridSearchService", () => {
  const engine: SearchEngine = {
    name: "stub",
    keyword: async () => ({ ids: ["k1", "both"], total: 2, facets: { category: { x: 2 } } }),
    filterIds: async (ids) => ids.filter((i) => i !== "filtered"),
    autocomplete: async () => [],
    upsert: async () => undefined,
    remove: async () => undefined,
    health: async () => true,
  };

  it("fuses semantic results that pass the filters", async () => {
    const ml = { semanticSearch: async () => [{ productId: "both", score: 0.9 }, { productId: "filtered", score: 0.8 }, { productId: "s1", score: 0.5 }, { productId: "noise", score: 0.01 }] } as unknown as MlClient;
    const res = await new HybridSearchService(engine, ml).search("warm jacket under 2000", {});
    expect(res.parsed.maxPrice).toBe(200000);
    expect(res.ids[0]).toBe("both");
    expect(res.ids).not.toContain("filtered");
    expect(res.ids).not.toContain("noise");
    expect(res.engines).toEqual({ keyword: "stub", semantic: true });
  });

  it("degrades to keyword-only when the ML service fails", async () => {
    const ml = { semanticSearch: async () => Promise.reject(new Error("down")) } as unknown as MlClient;
    const res = await new HybridSearchService(engine, ml).search("jacket", {});
    expect(res.ids).toEqual(["k1", "both"]);
    expect(res.engines.semantic).toBe(false);
  });
});

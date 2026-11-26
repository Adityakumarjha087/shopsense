import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { cached } from "../../lib/cache.js";
import { defineRoute } from "../../lib/http.js";
import { CatalogService, type ProductCard } from "../catalog/catalog.service.js";
import { HybridSearchService } from "./hybrid.service.js";

const csv = z
  .string()
  .max(500)
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .optional();

export const SearchQuery = z.object({
  q: z.string().max(200).default(""),
  category: csv,
  brand: csv,
  color: csv,
  minPrice: z.coerce.number().int().nonnegative().optional().describe("paise"),
  maxPrice: z.coerce.number().int().nonnegative().optional().describe("paise"),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStock: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "rating", "newest"]).default("relevance"),
  page: z.coerce.number().int().min(1).max(100).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

export type SearchQueryInput = z.infer<typeof SearchQuery>;

function sortCards(cards: ProductCard[], sort: SearchQueryInput["sort"]): ProductCard[] {
  const out = [...cards];
  if (sort === "price_asc") out.sort((a, b) => a.price - b.price);
  if (sort === "price_desc") out.sort((a, b) => b.price - a.price);
  if (sort === "rating") out.sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount);
  return out;
}

export function createSearchService(ctx: AppContext) {
  const hybrid = new HybridSearchService(ctx.search, ctx.ml);
  const catalog = new CatalogService(ctx.prisma, ctx.cache);
  return async (query: SearchQueryInput) =>
    cached(ctx.cache, `search:${JSON.stringify(query)}`, 30, async () => {
      const result = await hybrid.search(query.q, {
        categories: query.category,
        brands: query.brand,
        colors: query.color,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        minRating: query.minRating,
        inStock: query.inStock,
      });
      let cards = await catalog.cardsByIds(result.ids);
      if (query.sort === "newest") {
        const created = await ctx.prisma.product.findMany({ where: { id: { in: result.ids } }, select: { id: true, createdAt: true } });
        const at = new Map(created.map((c) => [c.id, c.createdAt.getTime()]));
        cards = [...cards].sort((a, b) => (at.get(b.id) ?? 0) - (at.get(a.id) ?? 0));
      } else {
        cards = sortCards(cards, query.sort);
      }
      const start = (query.page - 1) * query.pageSize;
      return {
        items: cards.slice(start, start + query.pageSize),
        total: cards.length,
        page: query.page,
        pageSize: query.pageSize,
        parsed: result.parsed,
        facets: result.facets,
        engines: result.engines,
      };
    });
}

export function createSearchRouter(ctx: AppContext): Router {
  const router = Router();
  const search = createSearchService(ctx);

  defineRoute(
    router,
    {
      method: "get",
      path: "/",
      summary: "Hybrid keyword + semantic product search with filters (natural-language price constraints supported)",
      tags: ["Search"],
      query: SearchQuery,
    },
    async ({ query }) => search(query),
  );

  defineRoute(
    router,
    {
      method: "get",
      path: "/suggest",
      summary: "Typo-tolerant autocomplete",
      tags: ["Search"],
      query: z.object({ q: z.string().min(1).max(100), limit: z.coerce.number().int().min(1).max(10).default(6) }),
    },
    async ({ query }) =>
      cached(ctx.cache, `suggest:${query.q.toLowerCase()}:${query.limit}`, 60, async () => ({
        suggestions: await ctx.search.autocomplete(query.q, query.limit),
      })),
  );

  return router;
}

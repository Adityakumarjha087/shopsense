import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { defineRoute } from "../../lib/http.js";
import { CatalogService } from "./catalog.service.js";

export const ListQuery = z.object({
  category: z.string().max(80).optional(),
  sort: z.enum(["popular", "price_asc", "price_desc", "rating", "newest"]).default("popular"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
});

export function createCatalogRouter(ctx: AppContext): Router {
  const router = Router();
  const catalog = new CatalogService(ctx.prisma, ctx.cache);

  defineRoute(router, { method: "get", path: "/categories", summary: "List categories", tags: ["Catalog"] }, () => catalog.categories());

  defineRoute(
    router,
    { method: "get", path: "/products", summary: "Paginated product list", tags: ["Catalog"], query: ListQuery },
    ({ query }) => catalog.list(query),
  );

  defineRoute(
    router,
    {
      method: "get",
      path: "/products/:slug",
      summary: "Product detail by slug or id (variants, images, review summary)",
      tags: ["Catalog"],
      params: z.object({ slug: z.string().min(1).max(200) }),
    },
    ({ params }) => catalog.detail(params.slug),
  );

  defineRoute(
    router,
    {
      method: "get",
      path: "/products-slugs",
      summary: "Slugs of the most popular products (for static generation)",
      tags: ["Catalog"],
      query: z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) }),
    },
    async ({ query }) => {
      const rows = await ctx.prisma.product.findMany({
        where: { isActive: true },
        orderBy: [{ ratingCount: "desc" }, { id: "asc" }],
        select: { slug: true },
        take: query.limit,
      });
      return { slugs: rows.map((r) => r.slug) };
    },
  );

  return router;
}

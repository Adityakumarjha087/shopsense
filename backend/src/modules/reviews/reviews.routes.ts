import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { defineRoute } from "../../lib/http.js";
import { notFound } from "../../lib/errors.js";
import { sha256 } from "../../lib/id.js";
import { summarizeReviews } from "./summarizer.js";

const ProductParam = z.object({ productId: z.string().min(1).max(40) });

export function createReviewsRouter(ctx: AppContext): Router {
  const router = Router();

  const summaryFor = async (productId: string, force = false) => {
    const product = await ctx.prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
    if (!product) throw notFound("Product");
    const reviews = await ctx.prisma.review.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
      select: { id: true, rating: true, title: true, body: true },
      take: 200,
    });
    const hash = sha256(reviews.map((r) => r.id).join(","));
    const existing = await ctx.prisma.reviewSummary.findUnique({ where: { productId } });
    if (existing && existing.reviewsHash === hash && !force) {
      return { summary: existing.summary, pros: existing.pros, cons: existing.cons, provider: existing.provider, reviewCount: existing.reviewCount, cached: true };
    }
    const result = await summarizeReviews(reviews, ctx.llm, product.name);
    await ctx.prisma.reviewSummary.upsert({
      where: { productId },
      update: { ...result, reviewCount: reviews.length, reviewsHash: hash },
      create: { productId, ...result, reviewCount: reviews.length, reviewsHash: hash },
    });
    await ctx.cache.del(`catalog:detail:*`);
    return { ...result, reviewCount: reviews.length, cached: false };
  };

  defineRoute(
    router,
    {
      method: "get",
      path: "/:productId/reviews",
      summary: "Paginated reviews with rating histogram",
      tags: ["Reviews"],
      params: ProductParam,
      query: z.object({ page: z.coerce.number().int().min(1).max(100).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }),
    },
    async ({ params, query }) => {
      const [items, total, histogram] = await Promise.all([
        ctx.prisma.review.findMany({
          where: { productId: params.productId },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true, authorName: true, rating: true, title: true, body: true, createdAt: true },
        }),
        ctx.prisma.review.count({ where: { productId: params.productId } }),
        ctx.prisma.review.groupBy({ by: ["rating"], where: { productId: params.productId }, _count: { _all: true } }),
      ]);
      const hist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
      for (const h of histogram) hist[String(h.rating)] = h._count._all;
      return { items, total, page: query.page, pageSize: query.pageSize, histogram: hist };
    },
  );

  defineRoute(
    router,
    {
      method: "post",
      path: "/:productId/reviews",
      summary: "Write a review (updates rating aggregates)",
      tags: ["Reviews"],
      auth: "user",
      params: ProductParam,
      body: z.object({ rating: z.number().int().min(1).max(5), title: z.string().trim().min(2).max(120), body: z.string().trim().min(10).max(4000) }),
    },
    async ({ params, body }, req, res) => {
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
      const product = await ctx.prisma.product.findUnique({ where: { id: params.productId }, select: { id: true } });
      if (!product) throw notFound("Product");
      const review = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.review.create({ data: { productId: product.id, userId: user.id, authorName: user.name, ...body } });
        const agg = await tx.review.aggregate({ where: { productId: product.id }, _avg: { rating: true }, _count: { _all: true } });
        await tx.product.update({ where: { id: product.id }, data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all } });
        return created;
      });
      await ctx.onCatalogChange([product.id]);
      res.status(201);
      return review;
    },
  );

  defineRoute(
    router,
    {
      method: "get",
      path: "/:productId/review-summary",
      summary: "AI review summary (cached until reviews change)",
      tags: ["Reviews"],
      params: ProductParam,
    },
    ({ params }) => summaryFor(params.productId),
  );

  defineRoute(
    router,
    {
      method: "post",
      path: "/:productId/review-summary/regenerate",
      summary: "Force-regenerate the AI review summary",
      tags: ["Reviews"],
      auth: "admin",
      params: ProductParam,
    },
    ({ params }) => summaryFor(params.productId, true),
  );

  return router;
}

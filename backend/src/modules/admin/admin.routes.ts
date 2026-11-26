import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { defineRoute } from "../../lib/http.js";
import { AppError, notFound } from "../../lib/errors.js";
import { OrdersService, toOrderDto } from "../orders/orders.service.js";
import { ExperimentService, VariantSchema } from "../recommendations/experiments.js";
import { MlUnavailableError } from "../recommendations/ml-client.js";
import { AnalyticsService } from "./analytics.service.js";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const VariantInput = z.object({
  sku: z.string().trim().min(3).max(60),
  size: z.string().trim().max(20).nullish(),
  color: z.string().trim().max(40).nullish(),
  priceOverride: z.number().int().positive().nullish(),
  stock: z.number().int().min(0).max(100_000),
  lowStockThreshold: z.number().int().min(0).max(1000).default(5),
});

export const ProductInput = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  brand: z.string().trim().min(1).max(80),
  categoryId: z.string().min(1).max(40),
  basePrice: z.number().int().positive().max(100_000_000),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(20).default([]),
  attributes: z.record(z.string(), z.string().max(200)).default({}),
  images: z.array(z.object({ url: z.string().min(1).max(500), alt: z.string().max(200) })).max(8).default([]),
  variants: z.array(VariantInput).min(1).max(50),
  isActive: z.boolean().default(true),
});

const IdParam = z.object({ id: z.string().min(1).max(40) });

export function createAdminRouter(ctx: AppContext): Router {
  const router = Router();
  const analytics = new AnalyticsService(ctx.prisma);
  const orders = new OrdersService(ctx.prisma, ctx.payments);
  const experiments = new ExperimentService(ctx.prisma, ctx.cache);

  // ---- Products ----
  defineRoute(
    router,
    {
      method: "get",
      path: "/products",
      summary: "Admin product list (includes inactive)",
      tags: ["Admin"],
      auth: "admin",
      query: z.object({ q: z.string().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }),
    },
    async ({ query }) => {
      const where = query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" as const } }, { brand: { contains: query.q, mode: "insensitive" as const } }] } : {};
      const [items, total] = await Promise.all([
        ctx.prisma.product.findMany({
          where,
          include: { category: { select: { name: true, slug: true } }, variants: { select: { stock: true } } },
          orderBy: { updatedAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        ctx.prisma.product.count({ where }),
      ]);
      return {
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: items.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          brand: p.brand,
          basePrice: p.basePrice,
          isActive: p.isActive,
          category: p.category,
          totalStock: p.variants.reduce((s, v) => s + v.stock, 0),
          variantCount: p.variants.length,
          ratingAvg: p.ratingAvg,
          updatedAt: p.updatedAt,
        })),
      };
    },
  );

  defineRoute(
    router,
    { method: "get", path: "/products/:id", summary: "Admin product detail (editable fields)", tags: ["Admin"], auth: "admin", params: IdParam },
    async ({ params }) => {
      const product = await ctx.prisma.product.findUnique({ where: { id: params.id }, include: { images: { orderBy: { position: "asc" } }, variants: true } });
      if (!product) throw notFound("Product");
      return product;
    },
  );

  defineRoute(
    router,
    { method: "post", path: "/products", summary: "Create a product with variants", tags: ["Admin"], auth: "admin", body: ProductInput },
    async ({ body }, _req, res) => {
      const { images, variants, ...data } = body;
      const product = await ctx.prisma.product.create({
        data: {
          ...data,
          slug: `${slugify(body.name)}-${Date.now().toString(36)}`,
          images: { create: images.map((img, i) => ({ ...img, position: i })) },
          variants: { create: variants.map((v) => ({ ...v, size: v.size ?? null, color: v.color ?? null, priceOverride: v.priceOverride ?? null })) },
        },
      });
      await ctx.onCatalogChange([product.id]);
      res.status(201);
      return product;
    },
  );

  defineRoute(
    router,
    {
      method: "patch",
      path: "/products/:id",
      summary: "Update product fields (variants managed separately)",
      tags: ["Admin"],
      auth: "admin",
      params: IdParam,
      body: ProductInput.omit({ variants: true, images: true }).partial(),
    },
    async ({ params, body }) => {
      const product = await ctx.prisma.product.update({ where: { id: params.id }, data: body });
      await ctx.onCatalogChange([product.id]);
      return product;
    },
  );

  defineRoute(
    router,
    { method: "delete", path: "/products/:id", summary: "Archive a product (soft delete)", tags: ["Admin"], auth: "admin", params: IdParam },
    async ({ params }) => {
      await ctx.prisma.product.update({ where: { id: params.id }, data: { isActive: false } });
      await ctx.onCatalogChange([params.id]);
      return undefined;
    },
  );

  defineRoute(
    router,
    {
      method: "patch",
      path: "/variants/:id",
      summary: "Update variant stock / price / threshold",
      tags: ["Admin"],
      auth: "admin",
      params: IdParam,
      body: VariantInput.omit({ sku: true }).partial(),
    },
    async ({ params, body }) => {
      const variant = await ctx.prisma.productVariant.update({ where: { id: params.id }, data: body });
      await ctx.onCatalogChange([variant.productId]);
      return variant;
    },
  );

  defineRoute(
    router,
    {
      method: "post",
      path: "/products/:id/variants",
      summary: "Add a variant",
      tags: ["Admin"],
      auth: "admin",
      params: IdParam,
      body: VariantInput,
    },
    async ({ params, body }, _req, res) => {
      const variant = await ctx.prisma.productVariant.create({
        data: { ...body, productId: params.id, size: body.size ?? null, color: body.color ?? null, priceOverride: body.priceOverride ?? null },
      });
      await ctx.onCatalogChange([params.id]);
      res.status(201);
      return variant;
    },
  );

  // ---- Orders ----
  defineRoute(
    router,
    {
      method: "get",
      path: "/orders",
      summary: "All orders (filterable by status)",
      tags: ["Admin"],
      auth: "admin",
      query: z.object({
        status: z.enum(["PENDING", "PAID", "PAYMENT_FAILED", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
    },
    async ({ query }) => {
      const where = query.status ? { status: query.status } : {};
      const [rows, total] = await Promise.all([
        ctx.prisma.order.findMany({
          where,
          include: {
            user: { select: { email: true, name: true } },
            items: { include: { product: { select: { slug: true, images: { take: 1 } } } } },
            history: { orderBy: { createdAt: "asc" } },
          },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        ctx.prisma.order.count({ where }),
      ]);
      return { total, page: query.page, pageSize: query.pageSize, items: rows.map((o) => ({ ...toOrderDto(o), customer: o.user })) };
    },
  );

  defineRoute(
    router,
    {
      method: "patch",
      path: "/orders/:id/status",
      summary: "Advance fulfilment status (validated by the order state machine)",
      tags: ["Admin"],
      auth: "admin",
      params: IdParam,
      body: z.object({ status: z.enum(["SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]), reason: z.string().max(200).optional() }),
    },
    async ({ params, body }, req) => {
      await ctx.prisma.$transaction((tx) => orders.transition(tx, params.id, body.status, body.reason ?? `Updated by ${req.user!.email}`));
      return orders.get(params.id);
    },
  );

  // ---- Analytics & inventory ----
  defineRoute(
    router,
    { method: "get", path: "/analytics/sales", summary: "Revenue, orders, AOV, top products and category mix", tags: ["Admin"], auth: "admin", query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) },
    ({ query }) => analytics.sales(query.days),
  );

  defineRoute(router, { method: "get", path: "/inventory/alerts", summary: "Variants at or below their low-stock threshold", tags: ["Admin"], auth: "admin" }, () =>
    analytics.inventoryAlerts(),
  );

  // ---- Experiments (A/B) ----
  defineRoute(router, { method: "get", path: "/experiments", summary: "Recommendation A/B test with CTR and significance", tags: ["Admin"], auth: "admin" }, () =>
    experiments.stats(),
  );

  defineRoute(
    router,
    {
      method: "patch",
      path: "/experiments/rec_strategy",
      summary: "Toggle the A/B test or change variant weights/strategies",
      tags: ["Admin"],
      auth: "admin",
      body: z.object({ isActive: z.boolean().optional(), variants: z.array(VariantSchema).min(1).max(4).optional() }),
    },
    async ({ body }) => {
      await experiments.update(body);
      return experiments.stats();
    },
  );

  // ---- ML ----
  const mlProxy = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof MlUnavailableError) throw new AppError(503, "ML_UNAVAILABLE", err.message);
      throw err;
    }
  };
  defineRoute(router, { method: "get", path: "/ml/model", summary: "Active recommender model + offline metrics", tags: ["Admin"], auth: "admin" }, () =>
    mlProxy(() => ctx.ml.modelInfo()),
  );
  defineRoute(router, { method: "post", path: "/ml/train", summary: "Trigger a retraining run (logged to MLflow)", tags: ["Admin"], auth: "admin" }, async () => {
    const result = await mlProxy(() => ctx.ml.train());
    await ctx.cache.del("recs:*");
    return result;
  });

  return router;
}

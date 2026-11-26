import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { defineRoute } from "../../lib/http.js";
import { notFound } from "../../lib/errors.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { EventsService } from "../events/events.service.js";

const ProductParam = z.object({ productId: z.string().min(1).max(40) });

export function createWishlistRouter(ctx: AppContext): Router {
  const router = Router();
  const catalog = new CatalogService(ctx.prisma, ctx.cache);
  const events = new EventsService(ctx.prisma);

  const list = async (userId: string) => {
    const rows = await ctx.prisma.wishlistItem.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return { items: await catalog.cardsByIds(rows.map((r) => r.productId)) };
  };

  defineRoute(router, { method: "get", path: "/", summary: "List wishlist", tags: ["Wishlist"], auth: "user" }, (_i, req) => list(req.user!.id));

  defineRoute(
    router,
    { method: "post", path: "/:productId", summary: "Add product to wishlist", tags: ["Wishlist"], auth: "user", params: ProductParam },
    async ({ params }, req) => {
      const product = await ctx.prisma.product.findUnique({ where: { id: params.productId }, select: { id: true } });
      if (!product) throw notFound("Product");
      await ctx.prisma.wishlistItem.upsert({
        where: { userId_productId: { userId: req.user!.id, productId: product.id } },
        update: {},
        create: { userId: req.user!.id, productId: product.id },
      });
      await events.track([{ type: "WISHLIST", productId: product.id, userId: req.user!.id, sessionId: req.sessionId }]);
      return list(req.user!.id);
    },
  );

  defineRoute(
    router,
    { method: "delete", path: "/:productId", summary: "Remove product from wishlist", tags: ["Wishlist"], auth: "user", params: ProductParam },
    async ({ params }, req) => {
      await ctx.prisma.wishlistItem.deleteMany({ where: { userId: req.user!.id, productId: params.productId } });
      return list(req.user!.id);
    },
  );

  return router;
}

import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { defineRoute } from "../../lib/http.js";
import { EventsService } from "../events/events.service.js";
import { CartService, MAX_LINE_QTY } from "./cart.service.js";

const Line = z.object({ variantId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(MAX_LINE_QTY) });
const VariantParam = z.object({ variantId: z.string().min(1).max(40) });

export function createCartRouter(ctx: AppContext): Router {
  const router = Router();
  const cart = new CartService(ctx.prisma);
  const events = new EventsService(ctx.prisma);

  defineRoute(
    router,
    { method: "post", path: "/quote", summary: "Price a guest cart against live catalogue data", tags: ["Cart"], body: z.object({ items: z.array(Line).max(50) }) },
    ({ body }) => cart.quote(body.items),
  );

  defineRoute(router, { method: "get", path: "/", summary: "Get the signed-in user's cart", tags: ["Cart"], auth: "user" }, (_i, req) =>
    cart.get(req.user!.id),
  );

  defineRoute(
    router,
    { method: "post", path: "/items", summary: "Add a variant to the cart", tags: ["Cart"], auth: "user", body: Line },
    async ({ body }, req) => {
      const view = await cart.add(req.user!.id, body.variantId, body.quantity);
      const line = view.items.find((l) => l.variantId === body.variantId);
      if (line) await events.track([{ type: "ADD_TO_CART", productId: line.productId, userId: req.user!.id, sessionId: req.sessionId }]);
      return view;
    },
  );

  defineRoute(
    router,
    {
      method: "patch",
      path: "/items/:variantId",
      summary: "Set line quantity (0 removes)",
      tags: ["Cart"],
      auth: "user",
      params: VariantParam,
      body: z.object({ quantity: z.number().int().min(0).max(MAX_LINE_QTY) }),
    },
    ({ params, body }, req) => cart.setQuantity(req.user!.id, params.variantId, body.quantity),
  );

  defineRoute(
    router,
    { method: "delete", path: "/items/:variantId", summary: "Remove a line", tags: ["Cart"], auth: "user", params: VariantParam },
    ({ params }, req) => cart.remove(req.user!.id, params.variantId),
  );

  defineRoute(
    router,
    { method: "post", path: "/merge", summary: "Merge a guest cart after login", tags: ["Cart"], auth: "user", body: z.object({ items: z.array(Line).max(50) }) },
    ({ body }, req) => cart.merge(req.user!.id, body.items),
  );

  defineRoute(router, { method: "delete", path: "/", summary: "Empty the cart", tags: ["Cart"], auth: "user" }, async (_i, req) => {
    await cart.clear(req.user!.id);
    return undefined;
  });

  return router;
}

import express, { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { defineRoute } from "../../lib/http.js";
import { badRequest } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { OrdersService } from "./orders.service.js";

export const ShippingAddressSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().regex(/^\d{6}$/, "PIN code must be 6 digits"),
  phone: z.string().trim().regex(/^\+?\d{10,13}$/, "Phone must be 10–13 digits"),
});

const OrderParam = z.object({ id: z.string().min(1).max(40) });

export function createOrdersRouter(ctx: AppContext): Router {
  const router = Router();
  const orders = new OrdersService(ctx.prisma, ctx.payments);

  defineRoute(
    router,
    {
      method: "post",
      path: "/checkout",
      summary: "Create an order from the cart, reserve stock and open a payment intent",
      tags: ["Orders"],
      auth: "user",
      body: z.object({ shippingAddress: ShippingAddressSchema }),
    },
    async ({ body }, req, res) => {
      const result = await orders.checkout(req.user!, { ...body.shippingAddress, line2: body.shippingAddress.line2 ?? "" });
      res.status(201);
      return result;
    },
  );

  defineRoute(router, { method: "get", path: "/orders", summary: "Order history", tags: ["Orders"], auth: "user" }, (_i, req) =>
    orders.listForUser(req.user!.id),
  );

  defineRoute(
    router,
    { method: "get", path: "/orders/:id", summary: "Order detail with status history", tags: ["Orders"], auth: "user", params: OrderParam },
    ({ params }, req) => orders.get(params.id, req.user!.role === "ADMIN" ? undefined : req.user!.id),
  );

  defineRoute(
    router,
    { method: "post", path: "/orders/:id/cancel", summary: "Cancel an unpaid order (releases stock)", tags: ["Orders"], auth: "user", params: OrderParam },
    ({ params }, req) => orders.cancel(params.id, req.user!.id),
  );

  defineRoute(
    router,
    {
      method: "post",
      path: "/payments/mock/confirm",
      summary: "Mock mode: confirm payment with a test card; dispatches a signed webhook through the Stripe handler",
      tags: ["Payments"],
      auth: "user",
      body: z.object({ orderId: z.string().min(1).max(40), cardNumber: z.string().min(12).max(23) }),
    },
    ({ body }, req) => orders.confirmMockPayment(body.orderId, req.user!.id, body.cardNumber),
  );

  defineRoute(router, { method: "get", path: "/payments/config", summary: "Payment mode for the client", tags: ["Payments"] }, () => ({
    mode: ctx.payments.mode,
    currency: "INR",
    testCards: ctx.payments.mode === "mock" ? { success: "4242 4242 4242 4242", declined: "4000 0000 0000 0002" } : undefined,
  }));

  return router;
}

/** Stripe webhook endpoint; needs the raw body for signature verification, so it is mounted before express.json(). */
export function createWebhookRouter(ctx: AppContext): Router {
  const router = Router();
  const orders = new OrdersService(ctx.prisma, ctx.payments);
  router.post("/stripe", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") throw badRequest("Missing Stripe-Signature header");
    let event;
    try {
      event = ctx.payments.constructEvent(req.body as Buffer, signature);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "webhook signature verification failed");
      res.status(400).json({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
      return;
    }
    const result = await orders.handleWebhookEvent(event);
    res.json({ received: true, ...result });
  });
  return router;
}

import { Prisma, type OrderStatus, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { computeTotals } from "../../lib/money.js";
import { randomToken } from "../../lib/id.js";
import type { PaymentGateway } from "../payments/gateway.js";
import { CartService } from "../cart/cart.service.js";
import { canTransition, RESTOCK_ON } from "./state-machine.js";

type Tx = Prisma.TransactionClient;

export const ShippingAddressShape = {
  fullName: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  phone: "",
};
export type ShippingAddress = { [K in keyof typeof ShippingAddressShape]: K extends "line2" ? string | undefined : string };

const orderInclude = {
  items: { include: { product: { select: { slug: true, images: { orderBy: { position: "asc" as const }, take: 1 } } } } },
  history: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toOrderDto(o: OrderRow) {
  return {
    id: o.id,
    status: o.status,
    subtotal: o.subtotal,
    shipping: o.shipping,
    tax: o.tax,
    total: o.total,
    currency: o.currency,
    paymentProvider: o.paymentProvider,
    shippingAddress: o.shippingAddress,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    items: o.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      slug: i.product.slug,
      image: i.product.images[0]?.url ?? null,
      name: i.name,
      sku: i.sku,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
    history: o.history.map((h) => ({ from: h.fromStatus, to: h.toStatus, reason: h.reason, at: h.createdAt })),
  };
}

export type OrderDto = ReturnType<typeof toOrderDto>;

export const TEST_CARDS = {
  success: "4242424242424242",
  declined: "4000000000000002",
  insufficientFunds: "4000000000009995",
} as const;

export function luhnValid(card: string): boolean {
  const digits = card.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export class OrdersService {
  private readonly cart: CartService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly payments: PaymentGateway,
  ) {
    this.cart = new CartService(prisma);
  }

  async checkout(user: { id: string; email: string }, shippingAddress: ShippingAddress) {
    const cart = await this.cart.get(user.id);
    if (!cart.items.length) throw badRequest("Your cart is empty");

    const order = await this.prisma.$transaction(async (tx) => {
      // Reserve stock atomically: the conditional decrement fails if another checkout won the race.
      for (const line of cart.items) {
        const res = await tx.productVariant.updateMany({
          where: { id: line.variantId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (res.count === 0) throw conflict(`"${line.name}" no longer has enough stock`, { variantId: line.variantId });
      }
      const totals = computeTotals(cart.items.reduce((s, l) => s + l.lineTotal, 0));
      return tx.order.create({
        data: {
          userId: user.id,
          status: "PENDING",
          ...totals,
          currency: "INR",
          paymentProvider: this.payments.mode,
          shippingAddress,
          items: {
            create: cart.items.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              name: l.name,
              sku: l.sku,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
            })),
          },
          history: { create: { fromStatus: null, toStatus: "PENDING", reason: "Order placed" } },
        },
      });
    });

    try {
      const intent = await this.payments.createIntent({ orderId: order.id, amount: order.total, currency: order.currency, customerEmail: user.email });
      await this.prisma.order.update({ where: { id: order.id }, data: { paymentIntentId: intent.id } });
      return { order: await this.get(order.id, user.id), payment: { mode: this.payments.mode, clientSecret: intent.clientSecret, intentId: intent.id } };
    } catch (err) {
      logger.error({ err, orderId: order.id }, "payment intent creation failed");
      await this.prisma.$transaction((tx) => this.transition(tx, order.id, "CANCELLED", "Payment could not be initiated"));
      throw new AppError(502, "PAYMENT_PROVIDER_ERROR", "Payment provider unavailable, please retry");
    }
  }

  async get(orderId: string, userId?: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order || (userId && order.userId !== userId)) throw notFound("Order");
    return toOrderDto(order);
  }

  async listForUser(userId: string) {
    const orders = await this.prisma.order.findMany({ where: { userId }, include: orderInclude, orderBy: { createdAt: "desc" }, take: 50 });
    return orders.map(toOrderDto);
  }

  /** Applies a validated status transition inside a transaction, with history + restocking. */
  async transition(tx: Tx, orderId: string, to: OrderStatus, reason: string): Promise<boolean> {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw notFound("Order");
    if (order.status === to) return false;
    if (!canTransition(order.status, to)) throw conflict(`Cannot move order from ${order.status} to ${to}`);
    // Optimistic concurrency: only update if nobody changed the status meanwhile.
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: to, ...(to === "PAID" ? { paidAt: new Date() } : {}) },
    });
    if (updated.count === 0) throw conflict("Order was updated concurrently, retry");
    await tx.orderStatusEvent.create({ data: { orderId, fromStatus: order.status, toStatus: to, reason } });

    const reservationHeld = order.status === "PENDING" || order.status === "PAID";
    if (RESTOCK_ON.includes(to) && reservationHeld) {
      for (const item of order.items) {
        await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity } } });
      }
    }
    if (to === "PAID" && order.status === "PAYMENT_FAILED") {
      // Stock was released on failure; re-reserve (best effort, may go negative → flagged in inventory alerts).
      for (const item of order.items) {
        await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { decrement: item.quantity } } });
      }
    }
    if (to === "PAID") {
      await tx.event.createMany({
        data: order.items.map((i) => ({ type: "PURCHASE" as const, productId: i.productId, userId: order.userId, sessionId: `order-${order.id}` })),
      });
      await tx.cartItem.deleteMany({ where: { cart: { userId: order.userId }, variantId: { in: order.items.map((i) => i.variantId) } } });
    }
    return true;
  }

  async cancel(orderId: string, userId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw notFound("Order");
    if (order.status !== "PENDING" && order.status !== "PAYMENT_FAILED") throw conflict("Only unpaid orders can be cancelled");
    await this.prisma.$transaction((tx) => this.transition(tx, orderId, "CANCELLED", "Cancelled by customer"));
    if (order.paymentIntentId) await this.payments.cancelIntent(order.paymentIntentId);
    return this.get(orderId);
  }

  /** Idempotent webhook processing: the event id is recorded in the same transaction as its effects. */
  async handleWebhookEvent(event: Stripe.Event): Promise<{ status: "processed" | "duplicate" | "ignored"; orderId?: string }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.webhookEvent.create({ data: { id: event.id, provider: "stripe", type: event.type } });
        switch (event.type) {
          case "payment_intent.succeeded":
          case "payment_intent.payment_failed": {
            const intent = event.data.object;
            const order = await this.findOrderForIntent(tx, intent.id, intent.metadata?.orderId);
            if (!order) return { status: "ignored" as const };
            if (event.type === "payment_intent.succeeded") {
              if (intent.amount !== order.total) {
                logger.error({ orderId: order.id, expected: order.total, got: intent.amount }, "payment amount mismatch");
                return { status: "ignored" as const, orderId: order.id };
              }
              await this.transitionIfAllowed(tx, order.id, "PAID", "Payment confirmed via webhook");
            } else {
              const reason = intent.last_payment_error?.message ?? "Payment failed";
              await this.transitionIfAllowed(tx, order.id, "PAYMENT_FAILED", reason);
            }
            return { status: "processed" as const, orderId: order.id };
          }
          case "charge.refunded": {
            const charge = event.data.object;
            const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
            const order = intentId ? await this.findOrderForIntent(tx, intentId, charge.metadata?.orderId) : null;
            if (!order) return { status: "ignored" as const };
            await this.transitionIfAllowed(tx, order.id, "REFUNDED", "Refund issued");
            return { status: "processed" as const, orderId: order.id };
          }
          default:
            return { status: "ignored" as const };
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { status: "duplicate" };
      throw err;
    }
  }

  private async transitionIfAllowed(tx: Tx, orderId: string, to: OrderStatus, reason: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status === to || !canTransition(order.status, to)) {
      logger.info({ orderId, from: order.status, to }, "webhook transition skipped");
      return;
    }
    await this.transition(tx, orderId, to, reason);
  }

  private async findOrderForIntent(tx: Tx, intentId: string, orderId?: string) {
    const byIntent = await tx.order.findUnique({ where: { paymentIntentId: intentId } });
    if (byIntent) return byIntent;
    return orderId ? tx.order.findUnique({ where: { id: orderId } }) : null;
  }

  /**
   * Mock payment confirmation: builds a Stripe-shaped event, signs it with the webhook secret and
   * runs it through the exact verification + handler path used by real Stripe webhooks.
   */
  async confirmMockPayment(orderId: string, userId: string, cardNumber: string) {
    if (this.payments.mode !== "mock") throw badRequest("Mock payments are disabled when Stripe is configured");
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw notFound("Order");
    if (!order.paymentIntentId) throw conflict("Order has no payment intent");
    const digits = cardNumber.replace(/\D/g, "");
    if (!luhnValid(digits)) throw badRequest("Card number is invalid");

    const declined = digits === TEST_CARDS.declined || digits === TEST_CARDS.insufficientFunds;
    const event = {
      id: `evt_mock_${randomToken(12)}`,
      object: "event",
      api_version: "2025-01-27",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: declined ? "payment_intent.payment_failed" : "payment_intent.succeeded",
      data: {
        object: {
          id: order.paymentIntentId,
          object: "payment_intent",
          amount: order.total,
          currency: order.currency.toLowerCase(),
          metadata: { orderId: order.id },
          status: declined ? "requires_payment_method" : "succeeded",
          last_payment_error: declined
            ? { message: digits === TEST_CARDS.insufficientFunds ? "Your card has insufficient funds." : "Your card was declined." }
            : null,
        },
      },
    };
    const payload = JSON.stringify(event);
    const verified = this.payments.constructEvent(payload, this.payments.signPayload(payload));
    await this.handleWebhookEvent(verified);
    return this.get(orderId);
  }
}

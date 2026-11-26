import type { OrderStatus } from "@prisma/client";

/** Allowed order status transitions. Webhooks drive PENDING→PAID/PAYMENT_FAILED; admins drive fulfilment. */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["PAID", "PAYMENT_FAILED", "CANCELLED"],
  PAYMENT_FAILED: ["PAID", "CANCELLED"],
  PAID: ["SHIPPED", "REFUNDED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => TRANSITIONS[from].includes(to);

/** Statuses where reserved stock should be returned to inventory. */
export const RESTOCK_ON: readonly OrderStatus[] = ["PAYMENT_FAILED", "CANCELLED"];

/** Statuses that count as revenue. */
export const REVENUE_STATUSES: OrderStatus[] = ["PAID", "SHIPPED", "DELIVERED"];

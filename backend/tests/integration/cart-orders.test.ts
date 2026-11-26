import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { buildHarness, DEMO_CUSTOMER, ensureSeeded, inStockVariant, login, prisma, SHIPPING } from "../helpers.js";

const h = buildHarness();
const { app, ctx } = h;
let token = "";
const auth = () => ({ authorization: `Bearer ${token}` });

async function freshCheckout(quantity = 1) {
  const v = await inStockVariant(quantity + 1);
  await request(app).delete("/api/v1/cart").set(auth());
  const add = await request(app).post("/api/v1/cart/items").set(auth()).send({ variantId: v.id, quantity });
  expect(add.status).toBe(200);
  const res = await request(app).post("/api/v1/checkout").set(auth()).send({ shippingAddress: SHIPPING });
  expect(res.status).toBe(201);
  return { variant: v, order: res.body.order, payment: res.body.payment };
}

const stockOf = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;

describe("cart & wishlist", () => {
  beforeAll(async () => {
    await ensureSeeded();
    token = (await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password)).accessToken;
  });

  it("quotes guest carts against live prices", async () => {
    const v = await inStockVariant();
    const res = await request(app).post("/api/v1/cart/quote").send({ items: [{ variantId: v.id, quantity: 2 }, { variantId: "missing", quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.totals.subtotal).toBe((v.priceOverride ?? v.product.basePrice) * 2);
  });

  it("adds, updates, removes and merges lines with stock validation", async () => {
    const v = await inStockVariant(3);
    await request(app).delete("/api/v1/cart").set(auth());
    expect((await request(app).get("/api/v1/cart")).status).toBe(401);
    const add = await request(app).post("/api/v1/cart/items").set(auth()).send({ variantId: v.id, quantity: 1 });
    expect(add.body.itemCount).toBe(1);
    const events = await prisma.event.count({ where: { type: "ADD_TO_CART", productId: v.productId } });
    expect(events).toBeGreaterThan(0);
    const upd = await request(app).patch(`/api/v1/cart/items/${v.id}`).set(auth()).send({ quantity: 2 });
    expect(upd.body.items[0].quantity).toBe(2);
    const tooMany = await request(app).patch(`/api/v1/cart/items/${v.id}`).set(auth()).send({ quantity: v.stock + 1 > 10 ? 10 : v.stock + 1 });
    if (v.stock < 10) expect(tooMany.status).toBe(409);
    const del = await request(app).delete(`/api/v1/cart/items/${v.id}`).set(auth());
    expect(del.body.itemCount).toBe(0);
    const merged = await request(app).post("/api/v1/cart/merge").set(auth()).send({ items: [{ variantId: v.id, quantity: 2 }] });
    expect(merged.body.itemCount).toBe(2);
    expect((await request(app).post("/api/v1/cart/items").set(auth()).send({ variantId: "nope", quantity: 1 })).status).toBe(404);
    const oos = await prisma.productVariant.findFirst({ where: { stock: 0 } });
    if (oos) expect((await request(app).post("/api/v1/cart/items").set(auth()).send({ variantId: oos.id, quantity: 1 })).status).toBe(409);
  });

  it("manages the wishlist", async () => {
    const p = await prisma.product.findFirstOrThrow({ where: { isActive: true } });
    const add = await request(app).post(`/api/v1/wishlist/${p.id}`).set(auth());
    expect(add.body.items.map((i: { id: string }) => i.id)).toContain(p.id);
    expect((await request(app).get("/api/v1/wishlist").set(auth())).body.items.length).toBeGreaterThan(0);
    const del = await request(app).delete(`/api/v1/wishlist/${p.id}`).set(auth());
    expect(del.body.items.map((i: { id: string }) => i.id)).not.toContain(p.id);
    expect((await request(app).post("/api/v1/wishlist/unknown").set(auth())).status).toBe(404);
  });
});

describe("checkout & payments", () => {
  beforeAll(async () => {
    await ensureSeeded();
    token = (await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password)).accessToken;
  });

  it("rejects empty carts and invalid addresses", async () => {
    await request(app).delete("/api/v1/cart").set(auth());
    expect((await request(app).post("/api/v1/checkout").set(auth()).send({ shippingAddress: SHIPPING })).status).toBe(400);
    const bad = await request(app).post("/api/v1/checkout").set(auth()).send({ shippingAddress: { ...SHIPPING, postalCode: "12" } });
    expect(bad.status).toBe(400);
  });

  it("reserves stock, confirms a mock payment via the signed webhook path and records purchases", async () => {
    const { variant, order, payment } = await freshCheckout(2);
    expect(order.status).toBe("PENDING");
    expect(payment.mode).toBe("mock");
    expect(await stockOf(variant.id)).toBe(variant.stock - 2);

    const paid = await request(app).post("/api/v1/payments/mock/confirm").set(auth()).send({ orderId: order.id, cardNumber: "4242 4242 4242 4242" });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("PAID");
    expect(paid.body.history.map((x: { to: string }) => x.to)).toEqual(["PENDING", "PAID"]);
    expect(await prisma.event.count({ where: { type: "PURCHASE", sessionId: `order-${order.id}` } })).toBe(1);
    expect((await request(app).get("/api/v1/cart").set(auth())).body.itemCount).toBe(0);

    const list = await request(app).get("/api/v1/orders").set(auth());
    expect(list.body.map((o: { id: string }) => o.id)).toContain(order.id);
    expect((await request(app).get(`/api/v1/orders/${order.id}`).set(auth())).body.status).toBe("PAID");
    expect((await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(auth())).status).toBe(409);
  });

  it("marks declined payments as failed and releases stock; a retry can still succeed", async () => {
    const { variant, order } = await freshCheckout(1);
    const failed = await request(app).post("/api/v1/payments/mock/confirm").set(auth()).send({ orderId: order.id, cardNumber: "4000 0000 0000 0002" });
    expect(failed.body.status).toBe("PAYMENT_FAILED");
    expect(failed.body.history.at(-1).reason).toMatch(/declined/);
    expect(await stockOf(variant.id)).toBe(variant.stock);
    const retry = await request(app).post("/api/v1/payments/mock/confirm").set(auth()).send({ orderId: order.id, cardNumber: "4242424242424242" });
    expect(retry.body.status).toBe("PAID");
    expect(await stockOf(variant.id)).toBe(variant.stock - 1);
    const invalid = await request(app).post("/api/v1/payments/mock/confirm").set(auth()).send({ orderId: order.id, cardNumber: "4242424242424241" });
    expect(invalid.status).toBe(400);
  });

  it("cancels unpaid orders and restocks", async () => {
    const { variant, order } = await freshCheckout(1);
    const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(auth());
    expect(res.body.status).toBe("CANCELLED");
    expect(await stockOf(variant.id)).toBe(variant.stock);
  });

  it("verifies Stripe webhook signatures and is idempotent", async () => {
    const { order, payment } = await freshCheckout(1);
    const event = {
      id: "evt_fixture_1",
      object: "event",
      type: "payment_intent.succeeded",
      created: 1,
      livemode: false,
      api_version: "2025-01-27",
      data: { object: { id: payment.intentId, object: "payment_intent", amount: order.total, currency: "inr", metadata: { orderId: order.id } } },
    };
    const payload = JSON.stringify(event);

    const unsigned = await request(app).post("/api/v1/webhooks/stripe").set("content-type", "application/json").send(payload);
    expect(unsigned.status).toBe(400);
    const forged = await request(app).post("/api/v1/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", "t=1,v1=deadbeef").send(payload);
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe("INVALID_SIGNATURE");

    const sig = ctx.payments.signPayload(payload);
    const ok = await request(app).post("/api/v1/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", sig).send(payload);
    expect(ok.body).toMatchObject({ received: true, status: "processed", orderId: order.id });
    const dup = await request(app).post("/api/v1/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", sig).send(payload);
    expect(dup.body.status).toBe("duplicate");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");

    const refund = JSON.stringify({ ...event, id: "evt_fixture_refund", type: "charge.refunded", data: { object: { id: "ch_1", object: "charge", payment_intent: payment.intentId, metadata: {} } } });
    const r = await request(app).post("/api/v1/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", ctx.payments.signPayload(refund)).send(refund);
    expect(r.body.status).toBe("processed");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REFUNDED");

    const other = JSON.stringify({ ...event, id: "evt_fixture_other", type: "customer.created", data: { object: { id: "cus_1" } } });
    expect((await request(app).post("/api/v1/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", ctx.payments.signPayload(other)).send(other)).body.status).toBe("ignored");
  });

  it("ignores webhook amount mismatches and unknown intents", async () => {
    const { order, payment } = await freshCheckout(1);
    const mk = (id: string, obj: Record<string, unknown>) => {
      const p = JSON.stringify({ id, object: "event", type: "payment_intent.succeeded", created: 1, livemode: false, data: { object: { object: "payment_intent", metadata: {}, ...obj } } });
      return request(app).post("/api/v1/webhooks/stripe").set("content-type", "application/json").set("stripe-signature", ctx.payments.signPayload(p)).send(p);
    };
    expect((await mk("evt_mismatch", { id: payment.intentId, amount: 1 })).body.status).toBe("ignored");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect((await mk("evt_unknown", { id: "pi_unknown", amount: 1 })).body.status).toBe("ignored");
  });

  it("exposes payment config", async () => {
    const res = await request(app).get("/api/v1/payments/config");
    expect(res.body).toMatchObject({ mode: "mock", currency: "INR" });
  });
});

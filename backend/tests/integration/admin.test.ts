import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { buildHarness, DEMO_ADMIN, DEMO_CUSTOMER, ensureSeeded, login, prisma } from "../helpers.js";

const h = buildHarness();
const { app } = h;
let admin = "";
let customer = "";
const as = (t: string) => ({ authorization: `Bearer ${t}` });

describe("admin", () => {
  beforeAll(async () => {
    await ensureSeeded();
    admin = (await login(app, DEMO_ADMIN.email, DEMO_ADMIN.password)).accessToken;
    customer = (await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password)).accessToken;
  });

  it("enforces RBAC", async () => {
    expect((await request(app).get("/api/v1/admin/products")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/products").set(as(customer))).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/products").set(as(admin))).status).toBe(200);
  });

  it("creates, updates, restocks and archives products", async () => {
    const category = await prisma.category.findFirstOrThrow();
    const create = await request(app)
      .post("/api/v1/admin/products")
      .set(as(admin))
      .send({
        name: "Test Brand Everyday Cotton Tee",
        description: "A soft everyday cotton tee for testing.",
        brand: "Test Brand",
        categoryId: category.id,
        basePrice: 49900,
        tags: ["Summer", "cotton"],
        images: [{ url: "/img/p/x/y/1.svg", alt: "tee" }],
        variants: [{ sku: "TEST-TEE-M", size: "M", color: "Black", stock: 2, lowStockThreshold: 5 }],
      });
    expect(create.status).toBe(201);
    expect(create.body.tags).toEqual(["summer", "cotton"]);
    const id = create.body.id as string;
    expect(h.catalogChanges.at(-1)).toEqual([id]);

    const detail = await request(app).get(`/api/v1/admin/products/${id}`).set(as(admin));
    expect(detail.body.variants).toHaveLength(1);
    const variantId = detail.body.variants[0].id as string;

    const alerts = await request(app).get("/api/v1/admin/inventory/alerts").set(as(admin));
    expect(alerts.body.items.some((a: { variantId: string }) => a.variantId === variantId)).toBe(true);

    expect((await request(app).patch(`/api/v1/admin/variants/${variantId}`).set(as(admin)).send({ stock: 50 })).body.stock).toBe(50);
    const addVar = await request(app).post(`/api/v1/admin/products/${id}/variants`).set(as(admin)).send({ sku: "TEST-TEE-L", size: "L", color: "Black", stock: 5 });
    expect(addVar.status).toBe(201);
    const patched = await request(app).patch(`/api/v1/admin/products/${id}`).set(as(admin)).send({ basePrice: 59900 });
    expect(patched.body.basePrice).toBe(59900);
    const list = await request(app).get("/api/v1/admin/products").query({ q: "Test Brand" }).set(as(admin));
    expect(list.body.items[0]).toMatchObject({ id, totalStock: 55, variantCount: 2 });

    expect((await request(app).delete(`/api/v1/admin/products/${id}`).set(as(admin))).status).toBe(204);
    expect((await request(app).get(`/api/v1/products/${create.body.slug}`)).status).toBe(404);
    expect((await request(app).get("/api/v1/admin/products/missing").set(as(admin))).status).toBe(404);
    expect((await request(app).post("/api/v1/admin/products").set(as(admin)).send({ name: "x" })).status).toBe(400);
  });

  it("lists orders and advances fulfilment through the state machine", async () => {
    const seeded = await prisma.order.findFirstOrThrow({ where: { status: "DELIVERED", user: { email: { not: DEMO_CUSTOMER.email } } } });
    const paid = await prisma.order.update({ where: { id: seeded.id }, data: { status: "PAID" } });
    const list = await request(app).get("/api/v1/admin/orders").query({ status: "PAID" }).set(as(admin));
    expect(list.body.items.every((o: { status: string }) => o.status === "PAID")).toBe(true);
    expect(list.body.items[0].customer.email).toBeTruthy();
    const shipped = await request(app).patch(`/api/v1/admin/orders/${paid.id}/status`).set(as(admin)).send({ status: "SHIPPED" });
    expect(shipped.body.status).toBe("SHIPPED");
    const delivered = await request(app).patch(`/api/v1/admin/orders/${paid.id}/status`).set(as(admin)).send({ status: "DELIVERED" });
    expect(delivered.body.history.at(-1)).toMatchObject({ from: "SHIPPED", to: "DELIVERED" });
    const invalid = await request(app).patch(`/api/v1/admin/orders/${paid.id}/status`).set(as(admin)).send({ status: "SHIPPED" });
    expect(invalid.status).toBe(409);
    // Admins can read any order.
    expect((await request(app).get(`/api/v1/orders/${paid.id}`).set(as(admin))).status).toBe(200);
    expect((await request(app).get(`/api/v1/orders/${paid.id}`).set(as(customer))).status).toBe(404);
  });

  it("reports sales analytics", async () => {
    const res = await request(app).get("/api/v1/admin/analytics/sales").query({ days: 365 }).set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.revenue).toBeGreaterThan(0);
    expect(res.body.orders).toBeGreaterThan(0);
    expect(res.body.daily.length).toBeGreaterThan(0);
    expect(res.body.topProducts.length).toBeGreaterThan(0);
    expect(res.body.revenueByCategory.length).toBeGreaterThan(0);
    expect(res.body.averageOrderValue).toBe(Math.round(res.body.revenue / res.body.orders));
  });

  it("manages the A/B experiment and proxies the ML service", async () => {
    const stats = await request(app).get("/api/v1/admin/experiments").set(as(admin));
    expect(stats.body.variants.map((v: { strategy: string }) => v.strategy)).toEqual(["als", "item_knn"]);
    const toggled = await request(app).patch("/api/v1/admin/experiments/rec_strategy").set(as(admin)).send({ isActive: false });
    expect(toggled.body.experiment.isActive).toBe(false);
    await request(app).patch("/api/v1/admin/experiments/rec_strategy").set(as(admin)).send({ isActive: true });

    expect((await request(app).get("/api/v1/admin/ml/model").set(as(admin))).body.version).toBe("stub");
    expect((await request(app).post("/api/v1/admin/ml/train").set(as(admin))).body.version).toBe("stub-2");
    h.ml.down = true;
    try {
      expect((await request(app).get("/api/v1/admin/ml/model").set(as(admin))).status).toBe(503);
    } finally {
      h.ml.down = false;
    }
  });
});

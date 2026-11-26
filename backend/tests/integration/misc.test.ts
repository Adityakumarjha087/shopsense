import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { buildHarness, DEMO_ADMIN, DEMO_CUSTOMER, ensureSeeded, login, prisma } from "../helpers.js";

const h = buildHarness();
const { app } = h;

describe("platform", () => {
  beforeAll(ensureSeeded);

  it("reports health of dependencies", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", checks: { database: true, ml: true, searchEngine: "postgres" }, llm: "fake", payments: "mock" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("serves an OpenAPI document and Swagger UI", async () => {
    const doc = await request(app).get("/api/openapi.json");
    expect(doc.body.openapi).toBe("3.1.0");
    expect(doc.body.paths["/api/v1/search"].get.parameters.some((p: { name: string }) => p.name === "q")).toBe(true);
    expect(doc.body.paths["/api/v1/admin/products"].post.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.body.paths["/api/v1/products/{slug}"]).toBeTruthy();
    expect((await request(app).get("/api/docs/")).status).toBe(200);
  });

  it("returns structured 404 and malformed JSON errors", async () => {
    const nf = await request(app).get("/api/v1/nope");
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe("NOT_FOUND");
    const bad = await request(app).post("/api/v1/auth/login").set("content-type", "application/json").send("{bad");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("BAD_JSON");
  });

  it("tracks client events but ignores unknown products and PURCHASE spoofing", async () => {
    const p = await prisma.product.findFirstOrThrow();
    const ok = await request(app)
      .post("/api/v1/events")
      .set("x-session-id", "events-session-1")
      .send({ events: [{ type: "VIEW", productId: p.id }, { type: "VIEW", productId: "ghost" }] });
    expect(ok.status).toBe(202);
    expect(ok.body.accepted).toBe(1);
    expect((await request(app).post("/api/v1/events").send({ events: [{ type: "PURCHASE", productId: p.id }] })).status).toBe(400);
  });
});

describe("reviews", () => {
  beforeAll(ensureSeeded);

  it("lists reviews with a histogram, accepts new ones and regenerates the AI summary", async () => {
    const p = await prisma.product.findFirstOrThrow({ where: { ratingCount: { gt: 2 } } });
    const list = await request(app).get(`/api/v1/products/${p.id}/reviews`).query({ pageSize: 3 });
    expect(list.body.items).toHaveLength(3);
    expect(Object.values(list.body.histogram as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(list.body.total);

    const s1 = await request(app).get(`/api/v1/products/${p.id}/review-summary`);
    expect(s1.body).toMatchObject({ provider: "extractive", cached: false });
    expect(s1.body.summary).toMatch(/reviews\)/);
    expect((await request(app).get(`/api/v1/products/${p.id}/review-summary`)).body.cached).toBe(true);

    const tok = (await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password)).accessToken;
    const created = await request(app)
      .post(`/api/v1/products/${p.id}/reviews`)
      .set("authorization", `Bearer ${tok}`)
      .send({ rating: 5, title: "Fantastic", body: "Really comfortable and great value for money." });
    expect(created.status).toBe(201);
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.ratingCount).toBe(p.ratingCount + 1);
    expect((await request(app).get(`/api/v1/products/${p.id}/review-summary`)).body.cached).toBe(false);

    const admin = (await login(app, DEMO_ADMIN.email, DEMO_ADMIN.password)).accessToken;
    const regen = await request(app).post(`/api/v1/products/${p.id}/review-summary/regenerate`).set("authorization", `Bearer ${admin}`);
    expect(regen.body.cached).toBe(false);
    expect((await request(app).get("/api/v1/products/missing/review-summary")).status).toBe(404);
    expect((await request(app).post("/api/v1/products/missing/reviews").set("authorization", `Bearer ${tok}`).send({ rating: 4, title: "ok ok", body: "long enough body" })).status).toBe(404);
  });
});

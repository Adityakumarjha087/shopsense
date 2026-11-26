import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { buildHarness, DEMO_CUSTOMER, ensureSeeded, login, prisma } from "../helpers.js";

const { app } = buildHarness();

describe("auth", () => {
  beforeAll(ensureSeeded);

  it("registers, adopts the anonymous session and returns a token pair", async () => {
    await request(app).post("/api/v1/events").set("x-session-id", "session-for-adopt-1").send({ events: [{ type: "VIEW", productId: (await prisma.product.findFirstOrThrow()).id }] });
    const res = await request(app)
      .post("/api/v1/auth/register")
      .set("x-session-id", "session-for-adopt-1")
      .send({ email: "New.User@Example.test", password: "Passw0rd!", name: "New User" });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "new.user@example.test", role: "CUSTOMER" });
    expect(res.body.accessToken).toBeTruthy();
    const adopted = await prisma.event.count({ where: { sessionId: "session-for-adopt-1", userId: res.body.user.id } });
    expect(adopted).toBe(1);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    const dup = await request(app).post("/api/v1/auth/register").send({ email: "new.user@example.test", password: "Passw0rd!", name: "X" });
    expect(dup.status).toBe(409);
    const weak = await request(app).post("/api/v1/auth/register").send({ email: "weak@example.test", password: "short", name: "X" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("logs in, reads /me and rejects bad credentials", async () => {
    const tokens = await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    const me = await request(app).get("/api/v1/auth/me").set("authorization", `Bearer ${tokens.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(DEMO_CUSTOMER.email);
    const bad = await request(app).post("/api/v1/auth/login").send({ email: DEMO_CUSTOMER.email, password: "wrong-password1" });
    expect(bad.status).toBe(401);
    const noUser = await request(app).post("/api/v1/auth/login").send({ email: "nobody@example.test", password: "whatever1" });
    expect(noUser.status).toBe(401);
    expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const first = await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    const rotated = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(first.refreshToken);

    const reuse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.message).toMatch(/reuse/);
    // The legitimately rotated token is now revoked too (family revocation).
    const after = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: rotated.body.refreshToken });
    expect(after.status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: "x".repeat(20) })).status).toBe(401);
  });

  it("logout revokes refresh tokens", async () => {
    const t = await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    expect((await request(app).post("/api/v1/auth/logout").send({ refreshToken: t.refreshToken })).status).toBe(204);
    expect((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: t.refreshToken })).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/logout").send({ refreshToken: "unknown-token-123" })).status).toBe(204);
  });

  it("exchanges OAuth identities only with the internal key", async () => {
    const body = { email: "google.user@example.test", name: "Google User", provider: "google" };
    expect((await request(app).post("/api/v1/auth/oauth").send(body)).status).toBe(401);
    const ok = await request(app).post("/api/v1/auth/oauth").set("x-internal-key", "test-internal-key-123456").send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe("google.user@example.test");
    const again = await request(app).post("/api/v1/auth/oauth").set("x-internal-key", "test-internal-key-123456").send(body);
    expect(again.body.user.id).toBe(ok.body.user.id);
  });

  it("rejects expired refresh tokens", async () => {
    const t = await login(app, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await prisma.refreshToken.updateMany({ where: { revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: t.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/expired/);
  });
});

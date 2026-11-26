import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import type { AppContext } from "../../context.js";
import { defineRoute } from "../../lib/http.js";
import { notFound } from "../../lib/errors.js";
import { AuthService, toPublicUser } from "./auth.service.js";

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a digit");

export const RegisterBody = z.object({
  email: z.email().max(200),
  password,
  name: z.string().trim().min(1).max(80),
});
const LoginBody = z.object({ email: z.email(), password: z.string().min(1).max(128) });
const RefreshBody = z.object({ refreshToken: z.string().min(10).max(200) });
const OAuthBody = z.object({ email: z.email(), name: z.string().min(1).max(80), provider: z.enum(["google"]) });

export function createAuthRouter(ctx: AppContext): Router {
  const router = Router();
  const service = new AuthService(ctx.prisma);
  const authLimiter = rateLimit({
    windowMs: ctx.rateLimits.windowMs,
    limit: ctx.rateLimits.authMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many authentication attempts" } },
  });

  defineRoute(
    router,
    { method: "post", path: "/register", summary: "Create a customer account", tags: ["Auth"], body: RegisterBody, middleware: [authLimiter] },
    async ({ body }, req, res) => {
      const user = await service.register(body);
      await service.adoptSession(user.id, req.sessionId);
      res.status(201);
      return service.issueTokens(user);
    },
  );

  defineRoute(
    router,
    { method: "post", path: "/login", summary: "Email + password login (returns JWT pair)", tags: ["Auth"], body: LoginBody, middleware: [authLimiter] },
    async ({ body }, req) => {
      const user = await service.verifyCredentials(body.email, body.password);
      await service.adoptSession(user.id, req.sessionId);
      return service.issueTokens(user);
    },
  );

  defineRoute(
    router,
    { method: "post", path: "/refresh", summary: "Rotate refresh token", tags: ["Auth"], body: RefreshBody, middleware: [authLimiter] },
    async ({ body }) => service.refresh(body.refreshToken),
  );

  defineRoute(
    router,
    { method: "post", path: "/logout", summary: "Revoke the refresh token family", tags: ["Auth"], body: RefreshBody },
    async ({ body }) => {
      await service.logout(body.refreshToken);
      return undefined;
    },
  );

  defineRoute(router, { method: "get", path: "/me", summary: "Current user", tags: ["Auth"], auth: "user" }, async (_i, req) => {
    const user = await ctx.prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound("User");
    return toPublicUser(user);
  });

  defineRoute(
    router,
    {
      method: "post",
      path: "/oauth",
      summary: "Server-to-server: exchange a verified OAuth identity (NextAuth) for a JWT pair",
      tags: ["Auth"],
      auth: "internal",
      body: OAuthBody,
    },
    async ({ body }) => {
      const user = await service.upsertOAuthUser(body);
      return service.issueTokens(user);
    },
  );

  return router;
}

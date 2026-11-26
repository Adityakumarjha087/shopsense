import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export type UserRole = "CUSTOMER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
    sessionId: string;
    requestId: string;
  }
}

interface AccessClaims {
  sub: string;
  email: string;
  role: UserRole;
  typ: "access";
}

export function signAccessToken(user: AuthUser): string {
  const claims: AccessClaims = { sub: user.id, email: user.email, role: user.role, typ: "access" };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL_SECONDS, issuer: "shopsense" });
}

export function verifyAccessToken(token: string): AuthUser {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: "shopsense" }) as AccessClaims;
  if (decoded.typ !== "access") throw unauthorized("Wrong token type");
  return { id: decoded.sub, email: decoded.email, role: decoded.role };
}

/** Populates req.user when a valid bearer token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = verifyAccessToken(header.slice(7));
    } catch {
      // Invalid/expired tokens are treated as anonymous here; protected routes reject below.
      req.user = undefined;
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    const header = req.headers.authorization;
    next(unauthorized(header ? "Invalid or expired token" : "Authentication required"));
    return;
  }
  next();
}

export const requireRole =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };

export function requireInternal(req: Request, _res: Response, next: NextFunction): void {
  const provided = Buffer.from(String(req.headers["x-internal-key"] ?? ""));
  const expected = Buffer.from(env.INTERNAL_API_KEY);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    next(unauthorized("Invalid internal key"));
    return;
  }
  next();
}

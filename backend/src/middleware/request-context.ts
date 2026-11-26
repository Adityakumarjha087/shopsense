import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Assigns a request id and an anonymous session id (from `x-session-id`) to every request. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  req.requestId = typeof incoming === "string" && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader("x-request-id", req.requestId);
  const session = req.headers["x-session-id"];
  req.sessionId = typeof session === "string" && SESSION_RE.test(session) ? session : `anon-${req.requestId}`;
  next();
}

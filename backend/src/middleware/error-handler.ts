import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found`, requestId: req.requestId } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let body: ErrorBody = { error: { code: "INTERNAL", message: "Internal server error" } };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      status = 409;
      body = { error: { code: "CONFLICT", message: "Resource already exists" } };
    } else if (err.code === "P2025") {
      status = 404;
      body = { error: { code: "NOT_FOUND", message: "Resource not found" } };
    }
  } else if (err instanceof SyntaxError && "body" in err) {
    status = 400;
    body = { error: { code: "BAD_JSON", message: "Malformed JSON body" } };
  } else if (typeof err === "object" && err && "type" in err && err.type === "entity.too.large") {
    status = 413;
    body = { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } };
  }

  if (status >= 500) logger.error({ err, requestId: req.requestId }, "unhandled error");
  body.error.requestId = req.requestId;
  res.status(status).json(body);
}

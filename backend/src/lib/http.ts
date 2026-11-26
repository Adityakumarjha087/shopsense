import type { NextFunction, Request, Response, Router } from "express";
import type { z } from "zod";
import { registerRoute } from "../openapi/registry.js";
import { requireAuth, requireInternal, requireRole } from "../middleware/auth.js";

type Method = "get" | "post" | "put" | "patch" | "delete";
type Schema = z.ZodType;
type Infer<S> = S extends z.ZodType ? z.infer<S> : undefined;

export interface RouteSpec<B extends Schema | undefined, Q extends Schema | undefined, P extends Schema | undefined> {
  method: Method;
  path: string;
  summary: string;
  tags: string[];
  auth?: "none" | "optional" | "user" | "admin" | "internal";
  body?: B;
  query?: Q;
  params?: P;
  /** Extra middleware (e.g. stricter rate limits, raw body parsers). */
  middleware?: Array<(req: Request, res: Response, next: NextFunction) => void>;
}

export interface Input<B, Q, P> {
  body: B;
  query: Q;
  params: P;
}

/**
 * Declares an Express route with zod validation of body/query/params and registers it in
 * the OpenAPI document — a single source of truth for validation and docs.
 */
export function defineRoute<
  B extends Schema | undefined = undefined,
  Q extends Schema | undefined = undefined,
  P extends Schema | undefined = undefined,
>(
  router: Router,
  spec: RouteSpec<B, Q, P>,
  handler: (input: Input<Infer<B>, Infer<Q>, Infer<P>>, req: Request, res: Response) => Promise<unknown> | unknown,
): void {
  const auth = spec.auth ?? "none";
  registerRoute({ ...spec, owner: router, auth, body: spec.body, query: spec.query, params: spec.params });

  const guards = [];
  if (auth === "user") guards.push(requireAuth);
  if (auth === "admin") guards.push(requireAuth, requireRole("ADMIN"));
  if (auth === "internal") guards.push(requireInternal);

  router[spec.method](spec.path, ...(spec.middleware ?? []), ...guards, async (req: Request, res: Response) => {
    const input = {
      body: spec.body ? spec.body.parse(req.body ?? {}) : undefined,
      query: spec.query ? spec.query.parse(req.query) : undefined,
      params: spec.params ? spec.params.parse(req.params) : undefined,
    } as Input<Infer<B>, Infer<Q>, Infer<P>>;
    const result = await handler(input, req, res);
    if (!res.headersSent) {
      if (result === undefined) res.status(204).end();
      else res.json(result);
    }
  });
}

import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import { pinoHttp } from "pino-http";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import type { AppContext } from "./context.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { optionalAuth } from "./middleware/auth.js";
import { requestContext } from "./middleware/request-context.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { buildOpenApiDocument } from "./openapi/registry.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createCatalogRouter } from "./modules/catalog/catalog.routes.js";
import { createSearchRouter } from "./modules/search/search.routes.js";
import { createCartRouter } from "./modules/cart/cart.routes.js";
import { createWishlistRouter } from "./modules/cart/wishlist.routes.js";
import { createOrdersRouter, createWebhookRouter } from "./modules/orders/orders.routes.js";
import { createEventsRouter } from "./modules/events/events.routes.js";
import { createRecommendationsRouter } from "./modules/recommendations/recommendations.routes.js";
import { createReviewsRouter } from "./modules/reviews/reviews.routes.js";
import { createAssistantRouter } from "./modules/assistant/assistant.routes.js";
import { createAdminRouter } from "./modules/admin/admin.routes.js";

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/api/v1/health" },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    }),
  );
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  const origins = env.CORS_ORIGINS.split(",").map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
      credentials: true,
      exposedHeaders: ["x-request-id"],
    }),
  );
  app.use(compression());

  const health = async () => {
    const [db, cache, search, ml] = await Promise.all([
      ctx.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      ctx.cache.ping(),
      ctx.search.health(),
      ctx.ml.health(),
    ]);
    return { status: db ? "ok" : "degraded", checks: { database: db, cache, search, searchEngine: ctx.search.name, ml }, llm: ctx.llm.name, payments: ctx.payments.mode };
  };
  const healthHandler = async (_req: express.Request, res: express.Response) => {
    const h = await health();
    res.status(h.status === "ok" ? 200 : 503).json(h);
  };
  app.get("/health", healthHandler);
  app.get("/api/v1/health", healthHandler);

  // Raw-body webhook must be registered before the JSON parser.
  app.use("/api/v1/webhooks", createWebhookRouter(ctx));

  app.use(express.json({ limit: "200kb" }));
  app.use(optionalAuth);
  app.use(
    "/api/",
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: () => env.NODE_ENV === "test",
      // Authenticated users and the Next.js server (internal key) are keyed separately from anonymous IPs.
      keyGenerator: (req) => req.user?.id ?? (req.headers["x-internal-key"] === env.INTERNAL_API_KEY ? "internal" : ipKeyGenerator(req.ip ?? "0.0.0.0")),
      message: { error: { code: "RATE_LIMITED", message: "Too many requests" } },
    }),
  );

  const v1 = express.Router();
  v1.use("/auth", createAuthRouter(ctx));
  v1.use("/", createCatalogRouter(ctx));
  v1.use("/products", createReviewsRouter(ctx));
  v1.use("/search", createSearchRouter(ctx));
  v1.use("/cart", createCartRouter(ctx));
  v1.use("/wishlist", createWishlistRouter(ctx));
  v1.use("/", createOrdersRouter(ctx));
  v1.use("/events", createEventsRouter(ctx));
  v1.use("/recommendations", createRecommendationsRouter(ctx));
  v1.use("/assistant", createAssistantRouter(ctx));
  v1.use("/admin", createAdminRouter(ctx));
  app.use("/api/v1", v1);

  const openapi = buildOpenApiDocument();
  app.get("/api/openapi.json", (_req, res) => {
    res.json(openapi);
  });
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "ShopSense API" }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

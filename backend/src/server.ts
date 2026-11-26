import { createApp } from "./app.js";
import { buildContext, syncSearchIndex } from "./bootstrap.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

async function main() {
  const ctx = await buildContext();
  const app = createApp(ctx);
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, llm: ctx.llm.name, payments: ctx.payments.mode, search: ctx.search.name }, "ShopSense backend listening");
  });

  if (env.SEARCH_SYNC_ON_START && ctx.search.name !== "postgres") {
    syncSearchIndex(ctx)
      .then((n) => logger.info({ documents: n }, "search index synced"))
      .catch((err: unknown) => logger.error({ err: (err as Error).message }, "search index sync failed"));
  }

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      void ctx.prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});

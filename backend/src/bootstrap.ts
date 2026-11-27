import type { AppContext } from "./context.js";
import { env } from "./config/env.js";
import { createCache } from "./lib/cache.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { createLlmProvider } from "./modules/llm/factory.js";
import { StripeGateway } from "./modules/payments/gateway.js";
import { createMlClient } from "./modules/recommendations/ml-client.js";
import { DbSearchEngine } from "./modules/search/db-engine.js";
import { MeiliSearchEngine } from "./modules/search/meili-engine.js";
import { buildSearchDocuments } from "./modules/search/documents.js";
import type { SearchEngine } from "./modules/search/engine.js";

/** Wires production dependencies from the environment. */
export async function buildContext(): Promise<AppContext> {
  const cache = createCache(env.REDIS_URL);
  const ml = createMlClient(env.ML_SERVICE_URL, env.ML_TIMEOUT_MS);
  let search: SearchEngine = new DbSearchEngine(prisma);
  if (env.MEILI_HOST) {
    const meili = new MeiliSearchEngine(env.MEILI_HOST, env.MEILI_MASTER_KEY, env.MEILI_INDEX);
    try {
      await meili.ensureIndex();
      search = meili;
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Meilisearch unavailable at startup; using Postgres search fallback");
    }
  }

  let refreshTimer: NodeJS.Timeout | undefined;
  const onCatalogChange = async (productIds: string[]) => {
    await cache.del("catalog:*");
    await cache.del("search:*");
    await cache.del("recs:*");
    try {
      const docs = await buildSearchDocuments(prisma, productIds);
      await search.upsert(docs);
      const inactive = productIds.filter((id) => !docs.some((d) => d.id === id));
      await search.remove(inactive);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "search index update failed");
    }
    // Debounced embedding refresh in the ML service.
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void ml.refreshIndex().catch(() => undefined), 5_000);
    refreshTimer.unref();
    if (env.FRONTEND_REVALIDATE_SECRET) {
      const slugs = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { slug: true } });
      void fetch(`${env.FRONTEND_URL}/api/revalidate`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": env.FRONTEND_REVALIDATE_SECRET },
        body: JSON.stringify({ slugs: slugs.map((s) => s.slug) }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => undefined);
    }
  };

  return {
    prisma,
    cache,
    ml,
    search,
    llm: createLlmProvider(env),
    payments: new StripeGateway(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET),
    onCatalogChange,
    rateLimits: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      authMax: env.RATE_LIMIT_AUTH_MAX,
      assistantMax: env.RATE_LIMIT_ASSISTANT_MAX,
    },
  };
}

/** Full (re)index of the catalogue into the search engine. */
export async function syncSearchIndex(ctx: AppContext): Promise<number> {
  const docs = await buildSearchDocuments(ctx.prisma);
  for (let i = 0; i < docs.length; i += 500) await ctx.search.upsert(docs.slice(i, i + 500));
  return docs.length;
}

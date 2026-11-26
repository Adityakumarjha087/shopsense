import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Cache } from "../../lib/cache.js";
import { cached } from "../../lib/cache.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { notFound } from "../../lib/errors.js";
import { CatalogService, type ProductCard } from "../catalog/catalog.service.js";
import { EventsService } from "../events/events.service.js";
import { ExperimentService } from "./experiments.js";
import type { MlClient } from "./ml-client.js";

export interface RecResponse {
  requestId: string | null;
  placement: string;
  strategy: string;
  variant: string | null;
  fallback: boolean;
  items: ProductCard[];
}

export class RecommendationsService {
  readonly catalog: CatalogService;
  readonly experiments: ExperimentService;
  private readonly events: EventsService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: Cache,
    private readonly ml: MlClient,
  ) {
    this.catalog = new CatalogService(prisma, cache);
    this.experiments = new ExperimentService(prisma, cache);
    this.events = new EventsService(prisma);
  }

  /** "Recommended for you": A/B-assigned strategy, cold-start popularity, ML-outage fallback. */
  async forYou(args: { userId?: string; sessionId: string; k: number; placement: string }): Promise<RecResponse> {
    const assignment = await this.experiments.assign(args.userId ?? args.sessionId);
    const [recent, purchased] = await Promise.all([
      this.events.recentProductIds({ userId: args.userId, sessionId: args.sessionId, limit: 20 }),
      args.userId ? this.events.purchasedProductIds(args.userId) : Promise.resolve([]),
    ]);
    let ids: string[];
    let strategy: string = assignment.strategy;
    let fallback = false;
    try {
      const res = await this.ml.recommendForUser({ userId: args.userId, recent, k: args.k, strategy: assignment.strategy, exclude: purchased });
      ids = res.items.map((i) => i.productId);
      strategy = res.strategy;
      fallback = res.fallback;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "ml recommend failed; db popularity fallback");
      const exclude = new Set([...purchased, ...recent]);
      ids = (await this.catalog.popularIds(args.k + exclude.size)).filter((id) => !exclude.has(id)).slice(0, args.k);
      strategy = "popularity_db";
      fallback = true;
    }
    const items = (await this.catalog.cardsByIds(ids)).slice(0, args.k);
    const requestId = randomUUID();
    if (items.length) {
      await this.prisma.recommendationEvent.create({
        data: {
          experimentKey: assignment.experimentKey,
          variant: assignment.variant,
          strategy,
          placement: args.placement,
          kind: "impression",
          itemCount: items.length,
          requestId,
          sessionId: args.sessionId,
          userId: args.userId ?? null,
        },
      });
    }
    return { requestId, placement: args.placement, strategy, variant: assignment.variant, fallback, items };
  }

  /** Records a click attributed to an earlier impression (variant is looked up server-side, not trusted from the client). */
  async recordClick(args: { requestId: string; productId: string; sessionId: string; userId?: string }): Promise<boolean> {
    const impression = await this.prisma.recommendationEvent.findFirst({ where: { requestId: args.requestId, kind: "impression" } });
    if (!impression) return false;
    const dup = await this.prisma.recommendationEvent.findFirst({
      where: { requestId: args.requestId, kind: "click", productId: args.productId },
      select: { id: true },
    });
    if (dup) return true;
    await this.prisma.recommendationEvent.create({
      data: {
        experimentKey: impression.experimentKey,
        variant: impression.variant,
        strategy: impression.strategy,
        placement: impression.placement,
        kind: "click",
        itemCount: 1,
        requestId: args.requestId,
        sessionId: args.sessionId,
        userId: args.userId ?? null,
        productId: args.productId,
      },
    });
    return true;
  }

  private async productOrThrow(productId: string) {
    const p = await this.prisma.product.findFirst({ where: { OR: [{ id: productId }, { slug: productId }] }, select: { id: true, categoryId: true } });
    if (!p) throw notFound("Product");
    return p;
  }

  /** "Similar items": content-embedding neighbours; same-category top-rated fallback. */
  async similar(productId: string, k: number): Promise<RecResponse> {
    const product = await this.productOrThrow(productId);
    return cached(this.cache, `recs:similar:${product.id}:${k}`, env.CACHE_TTL_SECONDS * 5, async () => {
      let ids: string[];
      let strategy = "content_embedding";
      let fallback = false;
      try {
        ids = (await this.ml.similar(product.id, k)).map((i) => i.productId);
      } catch {
        ids = (await this.catalog.popularIds(k + 1, product.categoryId)).filter((id) => id !== product.id);
        strategy = "category_popularity";
        fallback = true;
      }
      const items = (await this.catalog.cardsByIds(ids.filter((id) => id !== product.id))).slice(0, k);
      return { requestId: null, placement: "similar", strategy, variant: null, fallback, items };
    });
  }

  /** "Frequently bought together": association rules from the ML service, SQL co-purchase fallback. */
  async boughtTogether(productId: string, k: number): Promise<RecResponse & { rules: Array<{ productId: string; confidence: number; lift: number }> }> {
    const product = await this.productOrThrow(productId);
    return cached(this.cache, `recs:fbt:${product.id}:${k}`, env.CACHE_TTL_SECONDS * 5, async () => {
      let rules: Array<{ productId: string; confidence: number; lift: number }>;
      let strategy = "association_rules";
      let fallback = false;
      try {
        const res = await this.ml.boughtTogether(product.id, k);
        rules = res.items;
        strategy = res.source === "rules" ? "association_rules" : res.source;
      } catch {
        fallback = true;
        strategy = "co_purchase_sql";
        const rows = await this.prisma.$queryRaw<Array<{ product_id: string; together: bigint }>>`
          SELECT b.product_id, COUNT(DISTINCT a.order_id) AS together
          FROM order_items a
          JOIN order_items b ON a.order_id = b.order_id AND b.product_id <> a.product_id
          JOIN orders o ON o.id = a.order_id AND o.status IN ('PAID','SHIPPED','DELIVERED')
          WHERE a.product_id = ${product.id}
          GROUP BY b.product_id ORDER BY together DESC LIMIT ${k}`;
        rules = rows.map((r) => ({ productId: r.product_id, confidence: 0, lift: 0 }));
      }
      const items = await this.catalog.cardsByIds(rules.map((r) => r.productId));
      return { requestId: null, placement: "bought_together", strategy, variant: null, fallback, items, rules };
    });
  }
}

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { bucketOf } from "../../lib/id.js";
import type { Cache } from "../../lib/cache.js";
import { cached } from "../../lib/cache.js";
import type { RecStrategy } from "./ml-client.js";

export const REC_EXPERIMENT_KEY = "rec_strategy";

export const VariantSchema = z.object({
  key: z.string().min(1).max(8),
  strategy: z.enum(["als", "item_knn", "popularity"]),
  weight: z.number().int().min(0).max(100),
});
export type ExperimentVariant = z.infer<typeof VariantSchema>;

export const DEFAULT_VARIANTS: ExperimentVariant[] = [
  { key: "A", strategy: "als", weight: 50 },
  { key: "B", strategy: "item_knn", weight: 50 },
];

export interface Assignment {
  experimentKey: string;
  variant: string;
  strategy: RecStrategy;
}

/** Deterministic weighted assignment by hashing (experiment, subject). */
export function assignVariant(variants: ExperimentVariant[], subject: string, experimentKey = REC_EXPERIMENT_KEY): ExperimentVariant {
  const total = variants.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) return variants[0]!;
  const point = (bucketOf(`${experimentKey}:${subject}`) / 100) * total;
  let acc = 0;
  for (const v of variants) {
    acc += v.weight;
    if (point < acc) return v;
  }
  return variants[variants.length - 1]!;
}

export class ExperimentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: Cache,
  ) {}

  async getRecExperiment() {
    return cached(this.cache, `experiment:${REC_EXPERIMENT_KEY}`, 30, async () => {
      const exp = await this.prisma.experiment.upsert({
        where: { key: REC_EXPERIMENT_KEY },
        update: {},
        create: { key: REC_EXPERIMENT_KEY, name: "Recommended-for-you strategy", variants: DEFAULT_VARIANTS },
      });
      const variants = z.array(VariantSchema).safeParse(exp.variants);
      return { key: exp.key, name: exp.name, isActive: exp.isActive, variants: variants.success ? variants.data : DEFAULT_VARIANTS };
    });
  }

  async assign(subject: string): Promise<Assignment> {
    const exp = await this.getRecExperiment();
    const variant = exp.isActive ? assignVariant(exp.variants, subject) : exp.variants[0]!;
    return { experimentKey: exp.key, variant: variant.key, strategy: variant.strategy };
  }

  async update(input: { isActive?: boolean; variants?: ExperimentVariant[] }) {
    await this.getRecExperiment();
    await this.prisma.experiment.update({
      where: { key: REC_EXPERIMENT_KEY },
      data: { ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), ...(input.variants ? { variants: input.variants } : {}) },
    });
    await this.cache.del(`experiment:${REC_EXPERIMENT_KEY}`);
    return this.getRecExperiment();
  }

  /** Item-level CTR per variant with a two-proportion z-test of B vs A. */
  async stats() {
    const exp = await this.getRecExperiment();
    const grouped = await this.prisma.recommendationEvent.groupBy({
      by: ["variant", "kind"],
      where: { experimentKey: exp.key },
      _sum: { itemCount: true },
      _count: { _all: true },
    });
    const byVariant = exp.variants.map((v) => {
      const imp = grouped.find((g) => g.variant === v.key && g.kind === "impression");
      const clk = grouped.find((g) => g.variant === v.key && g.kind === "click");
      const impressions = imp?._sum.itemCount ?? 0;
      const clicks = clk?._count._all ?? 0;
      return {
        variant: v.key,
        strategy: v.strategy,
        weight: v.weight,
        requests: imp?._count._all ?? 0,
        impressions,
        clicks,
        ctr: impressions ? clicks / impressions : 0,
      };
    });
    const [a, b] = byVariant;
    return { experiment: exp, variants: byVariant, significance: a && b ? twoProportionZTest(a.clicks, a.impressions, b.clicks, b.impressions) : null };
  }
}

/** Two-sided two-proportion z-test. */
export function twoProportionZTest(c1: number, n1: number, c2: number, n2: number) {
  if (n1 === 0 || n2 === 0) return { z: 0, pValue: 1, significant: false };
  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const p = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, pValue: 1, significant: false };
  const z = (p2 - p1) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { z, pValue, significant: pValue < 0.05 };
}

/** Abramowitz–Stegun approximation of the standard normal CDF. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

import type { Prisma, PrismaClient } from "@prisma/client";
import type { KeywordResult, SearchDocument, SearchEngine, SearchFilters, Suggestion } from "./engine.js";

/**
 * Postgres fallback used when Meilisearch is not configured (tests, minimal setups).
 * Token AND-matching with ILIKE; no typo tolerance.
 */
export class DbSearchEngine implements SearchEngine {
  readonly name = "postgres";
  constructor(private readonly prisma: PrismaClient) {}

  private where(q: string, f: SearchFilters, ids?: string[]): Prisma.ProductWhereInput {
    const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1).slice(0, 8);
    return {
      isActive: true,
      ...(ids ? { id: { in: ids } } : {}),
      AND: [
        ...tokens.map((t) => ({
          OR: [
            { name: { contains: t, mode: "insensitive" as const } },
            { brand: { contains: t, mode: "insensitive" as const } },
            { description: { contains: t, mode: "insensitive" as const } },
            { tags: { has: t } },
            { category: { name: { contains: t, mode: "insensitive" as const } } },
          ],
        })),
        ...(f.categories?.length ? [{ category: { slug: { in: f.categories } } }] : []),
        ...(f.brands?.length ? [{ brand: { in: f.brands } }] : []),
        ...(f.minPrice !== undefined ? [{ basePrice: { gte: f.minPrice } }] : []),
        ...(f.maxPrice !== undefined ? [{ basePrice: { lte: f.maxPrice } }] : []),
        ...(f.minRating !== undefined ? [{ ratingAvg: { gte: f.minRating } }] : []),
        ...(f.inStock ? [{ variants: { some: { stock: { gt: 0 } } } }] : []),
        ...(f.colors?.length ? [{ variants: { some: { color: { in: f.colors } } } }] : []),
      ],
    };
  }

  async keyword(q: string, filters: SearchFilters, limit: number): Promise<KeywordResult> {
    const where = this.where(q, filters);
    const [rows, total, cats] = await Promise.all([
      this.prisma.product.findMany({ where, select: { id: true }, orderBy: [{ ratingCount: "desc" }, { id: "asc" }], take: limit }),
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, select: { category: { select: { slug: true } } } }),
    ]);
    const category: Record<string, number> = {};
    for (const c of cats) category[c.category.slug] = (category[c.category.slug] ?? 0) + 1;
    return { ids: rows.map((r) => r.id), total, facets: { category } };
  }

  async filterIds(ids: string[], filters: SearchFilters): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({ where: this.where("", filters, ids), select: { id: true } });
    const allowed = new Set(rows.map((r) => r.id));
    return ids.filter((id) => allowed.has(id));
  }

  async autocomplete(q: string, limit: number): Promise<Suggestion[]> {
    const rows = await this.prisma.product.findMany({
      where: { isActive: true, name: { contains: q, mode: "insensitive" } },
      select: { id: true, slug: true, name: true, category: { select: { name: true } } },
      orderBy: { ratingCount: "desc" },
      take: limit,
    });
    return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, category: r.category.name }));
  }

  async upsert(_docs: SearchDocument[]): Promise<void> {}
  async remove(_ids: string[]): Promise<void> {}
  async health(): Promise<boolean> {
    return true;
  }
}

import type { Prisma, PrismaClient } from "@prisma/client";
import type { Cache } from "../../lib/cache.js";
import { cached } from "../../lib/cache.js";
import { env } from "../../config/env.js";
import { notFound } from "../../lib/errors.js";

export const cardInclude = {
  category: { select: { slug: true, name: true } },
  images: { orderBy: { position: "asc" }, take: 1 },
  variants: { select: { id: true, priceOverride: true, stock: true, size: true, color: true } },
} satisfies Prisma.ProductInclude;

type CardRow = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  brand: string;
  price: number;
  currency: string;
  image: { url: string; alt: string } | null;
  ratingAvg: number;
  ratingCount: number;
  category: { slug: string; name: string };
  inStock: boolean;
  colors: string[];
}

export const effectivePrices = (row: { basePrice: number; variants: Array<{ priceOverride: number | null }> }): number[] =>
  row.variants.length ? row.variants.map((v) => v.priceOverride ?? row.basePrice) : [row.basePrice];

export function toCard(row: CardRow): ProductCard {
  const img = row.images[0];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    price: Math.min(...effectivePrices(row)),
    currency: row.currency,
    image: img ? { url: img.url, alt: img.alt } : null,
    ratingAvg: Math.round(row.ratingAvg * 10) / 10,
    ratingCount: row.ratingCount,
    category: row.category,
    inStock: row.variants.some((v) => v.stock > 0),
    colors: [...new Set(row.variants.map((v) => v.color).filter((c): c is string => !!c))],
  };
}

export interface ListParams {
  category?: string;
  sort: "popular" | "price_asc" | "price_desc" | "rating" | "newest";
  page: number;
  pageSize: number;
  minPrice?: number;
  maxPrice?: number;
}

export class CatalogService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: Cache,
  ) {}

  /** Hydrates product cards preserving the order of `ids` and dropping inactive/missing ones. */
  async cardsByIds(ids: string[]): Promise<ProductCard[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({ where: { id: { in: ids }, isActive: true }, include: cardInclude });
    const byId = new Map(rows.map((r) => [r.id, toCard(r)]));
    return ids.map((id) => byId.get(id)).filter((c): c is ProductCard => !!c);
  }

  async list(params: ListParams): Promise<{ items: ProductCard[]; total: number; page: number; pageSize: number }> {
    const key = `catalog:list:${JSON.stringify(params)}`;
    return cached(this.cache, key, env.CACHE_TTL_SECONDS, async () => {
      const where: Prisma.ProductWhereInput = {
        isActive: true,
        ...(params.category ? { category: { slug: params.category } } : {}),
        ...(params.minPrice !== undefined || params.maxPrice !== undefined
          ? { basePrice: { gte: params.minPrice, lte: params.maxPrice } }
          : {}),
      };
      const orderBy: Prisma.ProductOrderByWithRelationInput[] =
        params.sort === "price_asc"
          ? [{ basePrice: "asc" }]
          : params.sort === "price_desc"
            ? [{ basePrice: "desc" }]
            : params.sort === "rating"
              ? [{ ratingAvg: "desc" }, { ratingCount: "desc" }]
              : params.sort === "newest"
                ? [{ createdAt: "desc" }]
                : [{ ratingCount: "desc" }, { ratingAvg: "desc" }];
      const [rows, total] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include: cardInclude,
          orderBy: [...orderBy, { id: "asc" }],
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
        }),
        this.prisma.product.count({ where }),
      ]);
      return { items: rows.map(toCard), total, page: params.page, pageSize: params.pageSize };
    });
  }

  async detail(slugOrId: string) {
    return cached(this.cache, `catalog:detail:${slugOrId}`, env.CACHE_TTL_SECONDS, async () => {
      const row = await this.prisma.product.findFirst({
        where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
        include: {
          category: { select: { id: true, slug: true, name: true } },
          images: { orderBy: { position: "asc" } },
          variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
          reviewSummary: true,
        },
      });
      if (!row || !row.isActive) throw notFound("Product");
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        brand: row.brand,
        description: row.description,
        currency: row.currency,
        basePrice: row.basePrice,
        price: Math.min(...effectivePrices(row)),
        tags: row.tags,
        attributes: row.attributes as Record<string, string>,
        ratingAvg: Math.round(row.ratingAvg * 10) / 10,
        ratingCount: row.ratingCount,
        category: row.category,
        images: row.images.map((i) => ({ url: i.url, alt: i.alt })),
        variants: row.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          size: v.size,
          color: v.color,
          price: v.priceOverride ?? row.basePrice,
          stock: v.stock,
          inStock: v.stock > 0,
        })),
        reviewSummary: row.reviewSummary
          ? { summary: row.reviewSummary.summary, pros: row.reviewSummary.pros, cons: row.reviewSummary.cons, provider: row.reviewSummary.provider }
          : null,
      };
    });
  }

  async categories() {
    return cached(this.cache, "catalog:categories", env.CACHE_TTL_SECONDS * 10, async () => {
      const rows = await this.prisma.category.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { products: { where: { isActive: true } } } } },
      });
      return rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description, productCount: c._count.products }));
    });
  }

  /** Database-only popularity used as the cold-start / ML-outage fallback. */
  async popularIds(limit: number, categoryId?: string): Promise<string[]> {
    return cached(this.cache, `catalog:popular:${categoryId ?? "all"}:${limit}`, env.CACHE_TTL_SECONDS * 5, async () => {
      const rows = await this.prisma.product.findMany({
        where: { isActive: true, ...(categoryId ? { categoryId } : {}) },
        orderBy: [{ ratingCount: "desc" }, { ratingAvg: "desc" }, { id: "asc" }],
        select: { id: true },
        take: limit,
      });
      return rows.map((r) => r.id);
    });
  }

  async invalidate(): Promise<void> {
    await this.cache.del("catalog:*");
  }
}

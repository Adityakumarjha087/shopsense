import type { PrismaClient } from "@prisma/client";
import type { SearchDocument } from "./engine.js";

export async function buildSearchDocuments(prisma: PrismaClient, ids?: string[]): Promise<SearchDocument[]> {
  const rows = await prisma.product.findMany({
    where: { isActive: true, ...(ids ? { id: { in: ids } } : {}) },
    include: { category: true, variants: true },
  });
  return rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    description: p.description,
    category: p.category.slug,
    categoryName: p.category.name,
    tags: p.tags,
    colors: [...new Set(p.variants.map((v) => v.color).filter((c): c is string => !!c))],
    sizes: [...new Set(p.variants.map((v) => v.size).filter((s): s is string => !!s))],
    price: Math.min(...(p.variants.length ? p.variants.map((v) => v.priceOverride ?? p.basePrice) : [p.basePrice])),
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    inStock: p.variants.some((v) => v.stock > 0),
    createdAt: p.createdAt.getTime(),
  }));
}

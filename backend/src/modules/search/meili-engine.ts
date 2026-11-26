import { Meilisearch, type Index } from "meilisearch";
import type { KeywordResult, SearchDocument, SearchEngine, SearchFilters, Suggestion } from "./engine.js";

const quote = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

export function toMeiliFilter(f: SearchFilters, ids?: string[]): string[] {
  const out: string[] = [];
  if (f.categories?.length) out.push(`category IN [${f.categories.map(quote).join(", ")}]`);
  if (f.brands?.length) out.push(`brand IN [${f.brands.map(quote).join(", ")}]`);
  if (f.colors?.length) out.push(`colors IN [${f.colors.map(quote).join(", ")}]`);
  if (f.minPrice !== undefined) out.push(`price >= ${Math.floor(f.minPrice)}`);
  if (f.maxPrice !== undefined) out.push(`price <= ${Math.floor(f.maxPrice)}`);
  if (f.minRating !== undefined) out.push(`ratingAvg >= ${f.minRating}`);
  if (f.inStock) out.push("inStock = true");
  if (ids) out.push(`id IN [${ids.map(quote).join(", ")}]`);
  return out;
}

export class MeiliSearchEngine implements SearchEngine {
  readonly name = "meilisearch";
  private readonly client: Meilisearch;
  private readonly index: Index<SearchDocument>;

  constructor(host: string, apiKey: string | undefined, indexName: string) {
    this.client = new Meilisearch({ host, apiKey, timeout: 3000 });
    this.index = this.client.index<SearchDocument>(indexName);
  }

  /** Creates the index and applies settings (idempotent). */
  async ensureIndex(): Promise<void> {
    await this.client.createIndex(this.index.uid, { primaryKey: "id" }).waitTask().catch(() => undefined);
    await this.index
      .updateSettings({
        searchableAttributes: ["name", "brand", "categoryName", "tags", "colors", "description"],
        filterableAttributes: ["id", "category", "brand", "colors", "sizes", "price", "ratingAvg", "inStock"],
        sortableAttributes: ["price", "ratingAvg", "ratingCount", "createdAt"],
        rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness", "ratingCount:desc"],
        typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
        synonyms: {
          tee: ["t-shirt", "tshirt"],
          tshirt: ["t-shirt", "tee"],
          sneakers: ["trainers", "running shoes"],
          laptop: ["notebook"],
          earbuds: ["earphones", "headphones"],
          hoodie: ["sweatshirt"],
        },
        pagination: { maxTotalHits: 2000 },
      })
      .waitTask();
  }

  async keyword(q: string, filters: SearchFilters, limit: number): Promise<KeywordResult> {
    const res = await this.index.search(q, {
      filter: toMeiliFilter(filters),
      limit,
      // Drop the most frequent (least informative) words first when not all words match.
      matchingStrategy: "frequency",
      attributesToRetrieve: ["id"],
      facets: ["category", "brand", "colors"],
    });
    return {
      ids: res.hits.map((h) => h.id),
      total: res.estimatedTotalHits ?? res.hits.length,
      facets: (res.facetDistribution ?? {}) as Record<string, Record<string, number>>,
    };
  }

  async filterIds(ids: string[], filters: SearchFilters): Promise<string[]> {
    if (!ids.length) return [];
    const res = await this.index.search("", {
      filter: toMeiliFilter(filters, ids),
      limit: ids.length,
      attributesToRetrieve: ["id"],
    });
    const allowed = new Set(res.hits.map((h) => h.id));
    return ids.filter((id) => allowed.has(id));
  }

  async autocomplete(q: string, limit: number): Promise<Suggestion[]> {
    const res = await this.index.search(q, { limit, attributesToRetrieve: ["id", "slug", "name", "categoryName"] });
    return res.hits.map((h) => ({ id: h.id, slug: h.slug, name: h.name, category: h.categoryName }));
  }

  async upsert(docs: SearchDocument[]): Promise<void> {
    if (!docs.length) return;
    await this.index.addDocuments(docs, { primaryKey: "id" }).waitTask({ timeout: 60_000 });
  }

  async remove(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.index.deleteDocuments(ids).waitTask();
  }

  async health(): Promise<boolean> {
    try {
      return (await this.client.health()).status === "available";
    } catch {
      return false;
    }
  }
}

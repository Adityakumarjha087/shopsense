import { logger } from "../../lib/logger.js";
import type { MlClient } from "../recommendations/ml-client.js";
import type { SearchEngine, SearchFilters } from "./engine.js";
import { parseQuery, type ParsedQuery } from "./query-parser.js";

export interface HybridHit {
  id: string;
  score: number;
  sources: Array<"keyword" | "semantic">;
}

export interface HybridResult {
  ids: string[];
  hits: HybridHit[];
  total: number;
  parsed: ParsedQuery;
  facets: Record<string, Record<string, number>>;
  engines: { keyword: string; semantic: boolean };
}

const RRF_K = 60;
const CANDIDATES = 150;

/**
 * Weighted Reciprocal Rank Fusion of keyword (Meilisearch: typo tolerance, filters) and
 * semantic (ML embeddings) candidate lists. Semantic candidates are filtered through the
 * keyword engine so facet/price filters apply uniformly.
 */
export function reciprocalRankFusion(
  lists: Array<{ ids: string[]; weight: number; source: "keyword" | "semantic" }>,
): HybridHit[] {
  const scores = new Map<string, HybridHit>();
  for (const list of lists) {
    list.ids.forEach((id, rank) => {
      const hit = scores.get(id) ?? { id, score: 0, sources: [] };
      hit.score += list.weight / (RRF_K + rank + 1);
      if (!hit.sources.includes(list.source)) hit.sources.push(list.source);
      scores.set(id, hit);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export class HybridSearchService {
  constructor(
    private readonly engine: SearchEngine,
    private readonly ml: MlClient,
  ) {}

  async search(rawQuery: string, userFilters: SearchFilters, semanticWeight = 1): Promise<HybridResult> {
    const parsed = parseQuery(rawQuery);
    const filters: SearchFilters = {
      ...userFilters,
      maxPrice: userFilters.maxPrice ?? parsed.maxPrice,
      minPrice: userFilters.minPrice ?? parsed.minPrice,
      inStock: userFilters.inStock ?? parsed.inStock,
    };
    const text = parsed.text;

    const keywordP = this.engine.keyword(text, filters, CANDIDATES);
    const semanticP: Promise<string[] | null> =
      text.length >= 2
        ? this.ml
            .semanticSearch(text, CANDIDATES)
            .then((items) => this.engine.filterIds(items.filter((i) => i.score > 0.05).map((i) => i.productId), filters))
            .catch((err: unknown) => {
              logger.warn({ err: (err as Error).message }, "semantic search unavailable; keyword only");
              return null;
            })
        : Promise.resolve(null);

    const [keyword, semantic] = await Promise.all([keywordP, semanticP]);
    // Keyword matches get a slight edge: exact term hits are usually what shoppers mean.
    const hits = reciprocalRankFusion([
      { ids: keyword.ids, weight: 1.2, source: "keyword" },
      ...(semantic ? [{ ids: semantic, weight: semanticWeight, source: "semantic" as const }] : []),
    ]);
    return {
      ids: hits.map((h) => h.id),
      hits,
      total: Math.max(hits.length, Math.min(keyword.total, CANDIDATES)),
      parsed,
      facets: keyword.facets,
      engines: { keyword: this.engine.name, semantic: semantic !== null },
    };
  }
}

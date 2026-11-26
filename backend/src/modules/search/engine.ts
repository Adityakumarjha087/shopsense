export interface SearchFilters {
  categories?: string[];
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStock?: boolean;
  colors?: string[];
}

export interface SearchDocument {
  id: string;
  slug: string;
  name: string;
  brand: string;
  description: string;
  category: string;
  categoryName: string;
  tags: string[];
  colors: string[];
  sizes: string[];
  price: number;
  ratingAvg: number;
  ratingCount: number;
  inStock: boolean;
  createdAt: number;
}

export interface KeywordResult {
  ids: string[];
  total: number;
  facets: Record<string, Record<string, number>>;
}

export interface Suggestion {
  id: string;
  slug: string;
  name: string;
  category: string;
}

/** Keyword search backend (Meilisearch in prod; Postgres fallback). */
export interface SearchEngine {
  readonly name: string;
  keyword(q: string, filters: SearchFilters, limit: number): Promise<KeywordResult>;
  /** Returns the subset of `ids` matching `filters`, order preserved. */
  filterIds(ids: string[], filters: SearchFilters): Promise<string[]>;
  autocomplete(q: string, limit: number): Promise<Suggestion[]>;
  upsert(docs: SearchDocument[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  health(): Promise<boolean>;
}

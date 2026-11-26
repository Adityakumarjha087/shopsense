import { logger } from "../../lib/logger.js";

export type RecStrategy = "als" | "item_knn" | "popularity";

export interface ScoredItem {
  productId: string;
  score: number;
}

export interface UserRecResult {
  items: ScoredItem[];
  strategy: string;
  fallback: boolean;
}

export interface BoughtTogetherItem {
  productId: string;
  confidence: number;
  lift: number;
  support: number;
}

export interface MlClient {
  recommendForUser(args: {
    userId?: string;
    recent: string[];
    k: number;
    strategy: RecStrategy;
    exclude: string[];
  }): Promise<UserRecResult>;
  similar(productId: string, k: number): Promise<ScoredItem[]>;
  boughtTogether(productId: string, k: number): Promise<{ items: BoughtTogetherItem[]; source: string }>;
  popular(k: number, categoryId?: string): Promise<ScoredItem[]>;
  semanticSearch(query: string, k: number): Promise<ScoredItem[]>;
  modelInfo(): Promise<unknown>;
  train(): Promise<unknown>;
  refreshIndex(): Promise<void>;
  health(): Promise<boolean>;
}

export class MlUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MlUnavailableError";
  }
}

interface RawScored {
  product_id: string;
  score: number;
}

const mapScored = (items: RawScored[]): ScoredItem[] => items.map((i) => ({ productId: i.product_id, score: i.score }));

/** HTTP client for the FastAPI ML service with tight timeouts; callers own fallbacks. */
export class HttpMlClient implements MlClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(init?.timeoutMs ?? this.timeoutMs),
      });
    } catch (err) {
      logger.debug({ err, url }, "ml request failed");
      throw new MlUnavailableError(`ML service unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) throw new MlUnavailableError(`ML service responded ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  async recommendForUser(args: { userId?: string; recent: string[]; k: number; strategy: RecStrategy; exclude: string[] }) {
    const params = new URLSearchParams({ k: String(args.k), strategy: args.strategy });
    if (args.userId) params.set("user_id", args.userId);
    if (args.recent.length) params.set("recent", args.recent.join(","));
    if (args.exclude.length) params.set("exclude", args.exclude.join(","));
    const raw = await this.request<{ items: RawScored[]; strategy: string; fallback: boolean }>(`/recommend/user?${params}`);
    return { items: mapScored(raw.items), strategy: raw.strategy, fallback: raw.fallback };
  }

  async similar(productId: string, k: number) {
    const raw = await this.request<{ items: RawScored[] }>(`/similar/${encodeURIComponent(productId)}?k=${k}`);
    return mapScored(raw.items);
  }

  async boughtTogether(productId: string, k: number) {
    const raw = await this.request<{
      items: Array<{ product_id: string; confidence: number; lift: number; support: number }>;
      source: string;
    }>(`/bought-together/${encodeURIComponent(productId)}?k=${k}`);
    return {
      items: raw.items.map((i) => ({ productId: i.product_id, confidence: i.confidence, lift: i.lift, support: i.support })),
      source: raw.source,
    };
  }

  async popular(k: number, categoryId?: string) {
    const params = new URLSearchParams({ k: String(k) });
    if (categoryId) params.set("category_id", categoryId);
    const raw = await this.request<{ items: RawScored[] }>(`/popular?${params}`);
    return mapScored(raw.items);
  }

  async semanticSearch(query: string, k: number) {
    const raw = await this.request<{ items: RawScored[] }>(`/search/semantic`, {
      method: "POST",
      body: JSON.stringify({ query, k }),
    });
    return mapScored(raw.items);
  }

  modelInfo() {
    return this.request<unknown>("/models/current");
  }

  train() {
    return this.request<unknown>("/train", { method: "POST", timeoutMs: 300_000 });
  }

  async refreshIndex() {
    await this.request<unknown>("/index/refresh", { method: "POST", timeoutMs: 60_000 });
  }

  async health() {
    try {
      await this.request<unknown>("/health");
      return true;
    } catch {
      return false;
    }
  }
}

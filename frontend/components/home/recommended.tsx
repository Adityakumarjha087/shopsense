"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api";
import type { ProductCard, RecResponse } from "@/lib/types";
import { ProductGrid } from "@/components/product/product-card";
import { Skeleton } from "@/components/ui/skeleton";

const STRATEGY_LABEL: Record<string, string> = {
  als: "Collaborative filtering (ALS)",
  item_knn: "Item-to-item similarity",
  popularity: "Trending now",
  popularity_db: "Trending now",
};

/** Records a click for A/B CTR attribution. Uses keepalive so navigation doesn't cancel it. */
export function trackRecClick(requestId: string | null, product: ProductCard, token?: string) {
  if (!requestId) return;
  void api("/recommendations/click", { method: "POST", body: { requestId, productId: product.id }, token }).catch(() => undefined);
}

export function RecommendedForYou({ placement = "home", k = 10, title = "Recommended for you" }: { placement?: string; k?: number; title?: string }) {
  const { data: session, status } = useSession();
  const token = session?.accessToken;
  const [data, setData] = useState<RecResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    api<RecResponse>(`/recommendations/for-you?k=${k}&placement=${placement}`, { token })
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [status, token, k, placement]);

  return (
    <section aria-labelledby={`rec-${placement}`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`rec-${placement}`} className="text-xl font-semibold">
          {data?.fallback ? "Trending picks" : title}
        </h2>
        {data && (
          <span className="text-xs text-muted-foreground" title={`A/B variant ${data.variant ?? "-"}`}>
            {STRATEGY_LABEL[data.strategy] ?? data.strategy}
            {data.variant ? ` · variant ${data.variant}` : ""}
          </span>
        )}
      </div>
      {error ? (
        <p className="text-sm text-muted-foreground">Recommendations are unavailable right now.</p>
      ) : !data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" role="status" aria-label="Loading recommendations">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4]" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Browse a few products and we’ll tailor picks for you.</p>
      ) : (
        <ProductGrid products={data.items} onSelect={(p) => trackRecClick(data.requestId, p, token)} />
      )}
    </section>
  );
}

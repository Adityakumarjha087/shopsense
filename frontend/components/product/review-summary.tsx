"use client";

import { useEffect, useState } from "react";
import { Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { api } from "@/lib/api";
import type { ReviewSummary } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";

export function ReviewSummaryCard({ productId, initial }: { productId: string; initial: ReviewSummary | null }) {
  const [data, setData] = useState<ReviewSummary | null>(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (initial) return;
    api<ReviewSummary>(`/products/${productId}/review-summary`).then(setData).catch(() => setFailed(true));
  }, [productId, initial]);

  if (failed) return null;
  return (
    <section aria-labelledby="ai-summary" className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h2 id="ai-summary" className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-4 text-primary" aria-hidden="true" /> AI review summary
      </h2>
      {!data ? (
        <div className="mt-3 space-y-2" role="status" aria-label="Generating summary">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm" data-testid="review-summary">{data.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.pros.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300">
                <ThumbsUp className="size-3" aria-hidden="true" /> {p}
              </span>
            ))}
            {data.cons.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full bg-red-600/10 px-2.5 py-1 text-xs text-red-700 dark:text-red-300">
                <ThumbsDown className="size-3" aria-hidden="true" /> {c}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Generated from customer reviews ({data.provider}).</p>
        </>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { Review } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Rating } from "./rating";

interface ReviewPage {
  items: Review[];
  total: number;
  page: number;
  pageSize: number;
  histogram: Record<string, number>;
}

export function Reviews({ productId, ratingAvg }: { productId: string; ratingAvg: number }) {
  const { data: session } = useSession();
  const [data, setData] = useState<ReviewPage | null>(null);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ rating: 5, title: "", body: "" });
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(
    (p: number) => api<ReviewPage>(`/products/${productId}/reviews?page=${p}&pageSize=5`).then(setData).catch(() => undefined),
    [productId],
  );
  useEffect(() => {
    void load(page);
  }, [load, page]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    try {
      await api(`/products/${productId}/reviews`, { method: "POST", token: session?.accessToken, body: form });
      setForm({ rating: 5, title: "", body: "" });
      setStatus("Thanks! Your review was posted.");
      setPage(1);
      void load(1);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "Could not post review");
    }
  };

  const total = data?.total ?? 0;
  return (
    <section aria-labelledby="reviews" className="space-y-4">
      <h2 id="reviews" className="text-xl font-semibold">Customer reviews</h2>
      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <Rating value={ratingAvg} count={total} />
          {data && (
            <ul className="space-y-1" aria-label="Rating distribution">
              {[5, 4, 3, 2, 1].map((s) => {
                const n = data.histogram[String(s)] ?? 0;
                return (
                  <li key={s} className="flex items-center gap-2 text-xs">
                    <span className="w-6">{s}★</span>
                    <span className="h-2 flex-1 overflow-hidden rounded bg-muted">
                      <span className="block h-full bg-amber-400" style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
                    </span>
                    <span className="w-8 text-right text-muted-foreground">{n}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="space-y-4">
          {data?.items.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet — be the first!</p>}
          <ul className="space-y-4">
            {data?.items.map((r) => (
              <li key={r.id} className="border-b border-border pb-4 last:border-0">
                <div className="flex items-center gap-2">
                  <Rating value={r.rating} className="text-xs" />
                  <span className="font-medium">{r.title}</span>
                </div>
                <p className="mt-1 text-sm">{r.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.authorName} · {new Date(r.createdAt).toLocaleDateString("en-IN")}
                </p>
              </li>
            ))}
          </ul>
          {data && total > data.pageSize && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page * data.pageSize >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
          {session?.accessToken ? (
            <form onSubmit={submit} className="space-y-3 rounded-xl border border-border p-4" aria-label="Write a review">
              <p className="font-medium">Write a review</p>
              <label className="flex flex-col gap-1 text-sm">
                Rating
                <NativeSelect value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} className="w-32">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Title
                <Input required minLength={2} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Review
                <Textarea required minLength={10} maxLength={4000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </label>
              <Button type="submit">Post review</Button>
              {status && <p role="status" className="text-sm">{status}</p>}
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Link href="/login" className="text-primary underline">Sign in</Link> to write a review.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

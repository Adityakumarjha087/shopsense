"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { CheckCircle2, Circle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatPrice, STATUS_LABEL } from "@/lib/format";
import type { Order } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "./order-status";
import { TotalsBox } from "./totals";

/** Order confirmation + status timeline; polls while the payment webhook is pending. */
export function OrderDetail({ id, pollMs = 2000 }: { id: string; pollMs?: number }) {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const o = await api<Order>(`/orders/${id}`, { token });
        if (cancelled) return;
        setOrder(o);
        if (o.status === "PENDING") timer = setTimeout(load, pollMs);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError && err.status === 404 ? "Order not found" : "Could not load order");
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, token, pollMs]);

  const cancel = async () => {
    try {
      setOrder(await api<Order>(`/orders/${id}/cancel`, { method: "POST", token }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel");
    }
  };

  if (error) return <p role="alert" className="py-10 text-center text-destructive">{error}</p>;
  if (!order) return <p role="status" className="py-10 text-center text-muted-foreground">Loading order…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{order.status === "PAID" ? "Thank you for your order!" : "Order details"}</h1>
          <p className="text-sm text-muted-foreground">Order {order.id} · placed {formatDate(order.createdAt)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>
      <section aria-labelledby="timeline" className="rounded-xl border border-border p-5">
        <h2 id="timeline" className="mb-3 font-semibold">Status</h2>
        <ol className="space-y-3">
          {order.history.map((h, i) => (
            <li key={i} className="flex gap-3">
              {i === order.history.length - 1 ? <CheckCircle2 className="size-5 text-primary" aria-hidden="true" /> : <Circle className="size-5 text-muted-foreground" aria-hidden="true" />}
              <div>
                <p className="text-sm font-medium">{STATUS_LABEL[h.to] ?? h.to}</p>
                <p className="text-xs text-muted-foreground">{h.reason} · {formatDate(h.at)}</p>
              </div>
            </li>
          ))}
        </ol>
        {order.status === "PENDING" && <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">Waiting for payment confirmation…</p>}
      </section>
      <section aria-labelledby="items" className="rounded-xl border border-border p-5">
        <h2 id="items" className="mb-3 font-semibold">Items</h2>
        <ul className="divide-y divide-border">
          {order.items.map((i) => (
            <li key={i.variantId} className="flex items-center gap-3 py-2 text-sm">
              {i.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.image} alt="" width={48} height={48} className="size-12 rounded object-cover" />
              )}
              <Link href={`/p/${i.slug}`} className="flex-1 hover:underline">{i.name}</Link>
              <span>{i.quantity} × {formatPrice(i.unitPrice)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4"><TotalsBox totals={order} /></div>
      </section>
      {(order.status === "PENDING" || order.status === "PAYMENT_FAILED") && (
        <Button variant="outline" onClick={cancel}>Cancel order</Button>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import type { Order } from "@/lib/types";
import { OrderStatusBadge } from "./order-status";

export function OrderList() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!session?.accessToken) return;
    api<Order[]>("/orders", { token: session.accessToken }).then(setOrders).catch(() => setError(true));
  }, [session?.accessToken]);
  if (error) return <p role="alert" className="text-destructive">Could not load orders.</p>;
  if (!orders) return <p role="status" className="text-muted-foreground">Loading orders…</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Your orders</h1>
      {orders.length === 0 ? (
        <p className="text-muted-foreground">No orders yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/50">
                <span>
                  <span className="block text-sm font-medium">{o.items.length} item(s) · {formatPrice(o.total)}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</span>
                </span>
                <OrderStatusBadge status={o.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useAdminApi, useAdminQuery } from "@/lib/use-admin";
import { formatDate, formatPrice } from "@/lib/format";
import type { Order, OrderStatus } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { OrderStatusBadge } from "@/components/cart/order-status";

const NEXT: Partial<Record<OrderStatus, Array<"SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED">>> = {
  PAID: ["SHIPPED", "CANCELLED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["REFUNDED"],
};

type AdminOrder = Order & { customer: { email: string; name: string } };

export function AdminOrders() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, reload } = useAdminQuery<{ items: AdminOrder[]; total: number; pageSize: number }>(`/admin/orders?page=${page}${status ? `&status=${status}` : ""}`);
  const { call } = useAdminApi();
  const [msg, setMsg] = useState<string | null>(null);

  const update = async (id: string, to: string) => {
    setMsg(null);
    try {
      await call(`/admin/orders/${id}/status`, { method: "PATCH", body: { status: to } });
      reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Update failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Orders</h1>
        <label className="flex items-center gap-2 text-sm">
          Status
          <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {["PENDING", "PAID", "PAYMENT_FAILED", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"].map((s) => <option key={s} value={s}>{s}</option>)}
          </NativeSelect>
        </label>
      </div>
      {(error || msg) && <p role="alert" className="text-destructive">{error ?? msg}</p>}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr><th scope="col" className="p-3">Order</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Status</th><th scope="col">Actions</th></tr>
          </thead>
          <tbody>
            {data?.items.map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="p-3"><span className="font-mono text-xs">{o.id.slice(0, 12)}</span><span className="block text-xs text-muted-foreground">{formatDate(o.createdAt)}</span></td>
                <td>{o.customer.name}<span className="block text-xs text-muted-foreground">{o.customer.email}</span></td>
                <td>{formatPrice(o.total)}</td>
                <td><OrderStatusBadge status={o.status} /></td>
                <td className="space-x-1">
                  {(NEXT[o.status] ?? []).map((to) => (
                    <Button key={to} size="sm" variant="outline" onClick={() => update(o.id, to)}>{to.toLowerCase()}</Button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))} ({data.total} orders)</span>
          <Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

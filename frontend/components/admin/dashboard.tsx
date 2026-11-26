"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useAdminApi, useAdminQuery } from "@/lib/use-admin";
import { formatPrice } from "@/lib/format";
import type { ExperimentStats } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { NativeSelect } from "@/components/ui/input";
import { ABTestPanel } from "./ab-panel";
import { MlPanel, type ModelInfo } from "./ml-panel";
import type { SalesData } from "./sales-charts";

const SalesCharts = dynamic(() => import("./sales-charts"), { ssr: false, loading: () => <Skeleton className="h-72" /> });

interface Sales extends SalesData {
  days: number;
  revenue: number;
  orders: number;
  averageOrderValue: number;
  topProducts: Array<{ productId: string; name: string; units: number; revenue: number }>;
  statusBreakdown: Record<string, number>;
}

interface Alerts {
  count: number;
  items: Array<{ variantId: string; sku: string; size: string | null; color: string | null; stock: number; threshold: number; severity: string; product: { id: string; name: string; slug: string } }>;
}

export function AdminDashboard() {
  const [days, setDays] = useState(30);
  const sales = useAdminQuery<Sales>(`/admin/analytics/sales?days=${days}`);
  const alerts = useAdminQuery<Alerts>("/admin/inventory/alerts");
  const experiments = useAdminQuery<ExperimentStats>("/admin/experiments");
  const model = useAdminQuery<ModelInfo>("/admin/ml/model");
  const { call } = useAdminApi();
  const [training, setTraining] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const retrain = async () => {
    setTraining(true);
    setTrainError(null);
    try {
      model.setData(await call<ModelInfo>("/admin/ml/train", { method: "POST" }));
    } catch (err) {
      setTrainError(err instanceof ApiError ? err.message : "Training failed");
    } finally {
      setTraining(false);
    }
  };

  const toggle = async (isActive: boolean) => {
    setToggling(true);
    try {
      experiments.setData(await call<ExperimentStats>("/admin/experiments/rec_strategy", { method: "PATCH", body: { isActive } }));
    } finally {
      setToggling(false);
    }
  };

  const s = sales.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <label className="flex items-center gap-2 text-sm">
          Period
          <NativeSelect value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </NativeSelect>
        </label>
      </div>
      {sales.error && <p role="alert" className="text-destructive">{sales.error}</p>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Revenue", s ? formatPrice(s.revenue) : null],
          ["Orders", s ? s.orders.toLocaleString("en-IN") : null],
          ["Avg order value", s ? formatPrice(s.averageOrderValue) : null],
          ["Low-stock variants", alerts.data ? String(alerts.data.count) : null],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <p className="text-xs text-muted-foreground">{label}</p>
            </CardHeader>
            <CardContent>{value === null ? <Skeleton className="h-7 w-24" /> : <p className="text-2xl font-bold" data-testid={`kpi-${label}`}>{value}</p>}</CardContent>
          </Card>
        ))}
      </div>
      {s && <SalesCharts data={s} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {experiments.data ? <ABTestPanel stats={experiments.data} onToggle={toggle} busy={toggling} /> : <Skeleton className="h-48" />}
        <MlPanel model={model.data} error={model.error ?? trainError} onRetrain={retrain} busy={training} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top products</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground"><tr><th scope="col" className="py-2">Product</th><th scope="col">Units</th><th scope="col">Revenue</th></tr></thead>
              <tbody>
                {s?.topProducts.map((p) => (
                  <tr key={p.productId} className="border-t border-border">
                    <td className="py-2 pr-2">{p.name}</td>
                    <td>{p.units}</td>
                    <td>{formatPrice(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Inventory alerts</CardTitle></CardHeader>
          <CardContent className="max-h-96 overflow-y-auto">
            {alerts.data?.items.length === 0 && <p className="text-sm text-muted-foreground">All variants are above their thresholds.</p>}
            <ul className="divide-y divide-border text-sm">
              {alerts.data?.items.slice(0, 50).map((a) => (
                <li key={a.variantId} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <Link href={`/admin/products/${a.product.id}`} className="block truncate hover:underline">{a.product.name}</Link>
                    <span className="text-xs text-muted-foreground">{a.sku} {[a.size, a.color].filter(Boolean).join(" / ")}</span>
                  </span>
                  <Badge variant={a.severity === "out_of_stock" ? "danger" : "warning"}>{a.stock} left</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

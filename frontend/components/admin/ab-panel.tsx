"use client";

import type { ExperimentStats } from "@/lib/types";
import { formatPercent } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STRATEGY: Record<string, string> = { als: "ALS collaborative filtering", item_knn: "Item-kNN", popularity: "Popularity" };

export function ABTestPanel({ stats, onToggle, busy }: { stats: ExperimentStats; onToggle?: (active: boolean) => void; busy?: boolean }) {
  const best = [...stats.variants].sort((a, b) => b.ctr - a.ctr)[0];
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>A/B test: {stats.experiment.name}</CardTitle>
          <CardDescription>Item-level CTR of “Recommended for you” per strategy.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={stats.experiment.isActive ? "success" : "secondary"}>{stats.experiment.isActive ? "Running" : "Paused"}</Badge>
          {onToggle && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onToggle(!stats.experiment.isActive)}>
              {stats.experiment.isActive ? "Pause" : "Resume"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-2">Variant</th>
              <th scope="col">Strategy</th>
              <th scope="col">Traffic</th>
              <th scope="col">Impressions</th>
              <th scope="col">Clicks</th>
              <th scope="col">CTR</th>
            </tr>
          </thead>
          <tbody>
            {stats.variants.map((v) => (
              <tr key={v.variant} className="border-t border-border">
                <th scope="row" className="py-2 font-medium">{v.variant}{best && v.variant === best.variant && v.clicks > 0 ? " ★" : ""}</th>
                <td>{STRATEGY[v.strategy] ?? v.strategy}</td>
                <td>{v.weight}%</td>
                <td>{v.impressions.toLocaleString("en-IN")}</td>
                <td>{v.clicks.toLocaleString("en-IN")}</td>
                <td data-testid={`ctr-${v.variant}`}>{formatPercent(v.ctr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {stats.significance && (
          <p className="mt-3 text-xs text-muted-foreground">
            Two-proportion z-test (B vs A): z = {stats.significance.z.toFixed(2)}, p = {stats.significance.pValue.toFixed(3)} —{" "}
            {stats.significance.significant ? "statistically significant at 95%" : "not yet significant; keep collecting data"}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

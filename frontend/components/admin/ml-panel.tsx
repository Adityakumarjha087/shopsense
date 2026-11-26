"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface ModelInfo {
  version?: string;
  trained_at?: string;
  metrics?: Record<string, Record<string, number>>;
  dataset?: Record<string, number>;
}

export function MlPanel({ model, error, onRetrain, busy }: { model: ModelInfo | null; error?: string | null; onRetrain: () => void; busy: boolean }) {
  const metrics = model?.metrics ?? {};
  const k = Object.values(metrics)[0]?.k ?? 10;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Recommender model</CardTitle>
          <CardDescription>
            {model?.version ? `Version ${model.version}` : "No model loaded"}
            {model?.trained_at ? ` · trained ${new Date(model.trained_at).toLocaleString("en-IN")}` : ""}
          </CardDescription>
        </div>
        <Button size="sm" onClick={onRetrain} disabled={busy}>{busy ? "Training…" : "Retrain now"}</Button>
      </CardHeader>
      <CardContent>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {Object.keys(metrics).length > 0 && (
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-xs text-muted-foreground">Offline evaluation on a temporal holdout (k = {k})</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-2">Strategy</th>
                <th scope="col">Precision@k</th>
                <th scope="col">Recall@k</th>
                <th scope="col">NDCG@k</th>
                <th scope="col">Hit rate</th>
                <th scope="col">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics).map(([name, m]) => (
                <tr key={name} className="border-t border-border">
                  <th scope="row" className="py-2 font-medium">{name}</th>
                  <td>{(m.precision_at_k ?? 0).toFixed(3)}</td>
                  <td>{(m.recall_at_k ?? 0).toFixed(3)}</td>
                  <td>{(m.ndcg_at_k ?? 0).toFixed(3)}</td>
                  <td>{(m.hit_rate_at_k ?? 0).toFixed(3)}</td>
                  <td>{(m.coverage ?? 0).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {model?.dataset && (
          <p className="mt-3 text-xs text-muted-foreground">
            {Object.entries(model.dataset).map(([k2, v]) => `${k2.replace(/^n_/, "").replace(/_/g, " ")}: ${v}`).join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

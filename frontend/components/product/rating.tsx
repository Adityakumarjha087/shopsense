import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function Rating({ value, count, className }: { value: number; count?: number; className?: string }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)} aria-label={`Rated ${value.toFixed(1)} out of 5${count !== undefined ? ` from ${count} reviews` : ""}`}>
      <span className="flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cn("size-3.5", i <= rounded ? "fill-amber-400 text-amber-400" : i - 0.5 === rounded ? "fill-amber-400/50 text-amber-400" : "text-muted-foreground/40")} />
        ))}
      </span>
      <span className="font-medium">{value.toFixed(1)}</span>
      {count !== undefined && <span className="text-muted-foreground">({count})</span>}
    </span>
  );
}

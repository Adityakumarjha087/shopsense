"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useCart } from "@/lib/use-cart";
import type { ProductDetail } from "@/lib/types";

/** Adds the first in-stock variant of each "frequently bought together" product. */
export function AddAllButton({ slugs }: { slugs: string[] }) {
  const { add } = useCart();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  return (
    <Button
      variant="secondary"
      disabled={state === "busy" || !slugs.length}
      onClick={async () => {
        setState("busy");
        try {
          for (const slug of slugs) {
            const d = await api<ProductDetail>(`/products/${slug}`);
            const v = d.variants.find((x) => x.inStock);
            if (v) await add(v.id, 1);
          }
          setState("done");
        } catch {
          setState("error");
        }
      }}
    >
      {state === "done" ? "Added to cart" : state === "error" ? "Some items failed — retry" : "Add all to cart"}
    </Button>
  );
}

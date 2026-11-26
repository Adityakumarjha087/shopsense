"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api";
import type { ProductCard } from "@/lib/types";
import { ProductGrid } from "@/components/product/product-card";

export function WishlistView() {
  const { data: session } = useSession();
  const [items, setItems] = useState<ProductCard[] | null>(null);
  useEffect(() => {
    if (!session?.accessToken) return;
    api<{ items: ProductCard[] }>("/wishlist", { token: session.accessToken })
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [session?.accessToken]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Wishlist</h1>
      {!items ? <p role="status" className="text-muted-foreground">Loading…</p> : items.length === 0 ? <p className="text-muted-foreground">Nothing saved yet. Tap the heart on any product.</p> : <ProductGrid products={items} headingLevel={2} />}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useCart } from "@/lib/use-cart";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCartStore } from "@/store/cart";
import { TotalsBox } from "./totals";

export function CartView() {
  const { view, signedIn, setQuantity, remove, status } = useCart();
  const localCount = useCartStore((s) => s.lines.length);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const change = async (variantId: string, qty: number) => {
    setError(null);
    try {
      await setQuantity(variantId, qty);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update cart");
    }
  };

  if (status === "loading" || (!view && localCount > 0)) {
    return (
      <div role="status" aria-label="Loading cart" className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!view || view.items.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-muted-foreground">Find something you love — or ask the AI assistant for ideas.</p>
        <Button asChild className="mt-6"><Link href="/">Start shopping</Link></Button>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <section aria-labelledby="cart-title">
        <h1 id="cart-title" className="mb-4 text-2xl font-bold">Cart ({view.itemCount})</h1>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {view.items.map((l) => (
            <li key={l.variantId} className="flex gap-4 p-4" data-testid="cart-line">
              {l.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.image} alt="" width={80} height={80} className="size-20 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <Link href={`/p/${l.slug}`} className="font-medium hover:underline">{l.name}</Link>
                <p className="text-xs text-muted-foreground">{[l.size, l.color].filter(Boolean).join(" · ") || l.sku}</p>
                <p className="mt-1 text-sm">{formatPrice(l.unitPrice)}</p>
                {l.stock < l.quantity && <p className="text-xs text-destructive">Only {l.stock} in stock</p>}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-1" role="group" aria-label={`Quantity for ${l.name}`}>
                  <Button variant="outline" size="icon" className="size-8" aria-label="Decrease quantity" onClick={() => change(l.variantId, l.quantity - 1)}>
                    <Minus />
                  </Button>
                  <span className="w-8 text-center text-sm" aria-live="polite">{l.quantity}</span>
                  <Button variant="outline" size="icon" className="size-8" aria-label="Increase quantity" disabled={l.quantity >= Math.min(10, l.stock)} onClick={() => change(l.variantId, l.quantity + 1)}>
                    <Plus />
                  </Button>
                </div>
                <p className="text-sm font-semibold">{formatPrice(l.lineTotal)}</p>
                <Button variant="ghost" size="sm" onClick={() => remove(l.variantId)} aria-label={`Remove ${l.name}`}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </section>
      <aside className="h-fit space-y-4 rounded-xl border border-border bg-card p-5" aria-label="Order summary">
        <h2 className="font-semibold">Order summary</h2>
        <TotalsBox totals={view.totals} />
        {view.totals.shipping > 0 && <p className="text-xs text-muted-foreground">Free shipping on orders over ₹999.</p>}
        <Button size="lg" className="w-full" onClick={() => router.push(signedIn ? "/checkout" : "/login?callbackUrl=/checkout")}>
          {signedIn ? "Proceed to checkout" : "Sign in to checkout"}
        </Button>
      </aside>
    </div>
  );
}

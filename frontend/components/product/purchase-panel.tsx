"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Check, Heart, Loader2, ShoppingBag } from "lucide-react";
import type { ProductDetail } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/use-cart";
import { Button } from "@/components/ui/button";
import { findVariant, VariantPicker } from "./variant-picker";

export function PurchasePanel({ product }: { product: Pick<ProductDetail, "id" | "variants" | "price"> }) {
  const { add } = useCart();
  const { data: session } = useSession();
  const router = useRouter();
  const initial = product.variants.find((v) => v.inStock) ?? product.variants[0];
  const [sel, setSel] = useState<{ size: string | null; color: string | null }>({ size: initial?.size ?? null, color: initial?.color ?? null });
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");
  const [error, setError] = useState<string | null>(null);
  const [wish, setWish] = useState(false);
  const variant = findVariant(product.variants, sel.size, sel.color);

  const onAdd = async () => {
    if (!variant) return;
    setState("adding");
    setError(null);
    try {
      await add(variant.id, 1);
      setState("added");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add to cart");
      setState("idle");
    }
  };

  const onWish = async () => {
    if (!session?.accessToken) {
      router.push(`/login?callbackUrl=${encodeURIComponent(location.pathname)}`);
      return;
    }
    try {
      await api(`/wishlist/${product.id}`, { method: wish ? "DELETE" : "POST", token: session.accessToken });
      setWish(!wish);
    } catch {
      setError("Could not update wishlist");
    }
  };

  const stockLabel = !variant ? "Select an option" : variant.stock === 0 ? "Out of stock" : variant.stock <= 5 ? `Only ${variant.stock} left` : "In stock";
  return (
    <div className="space-y-5">
      <p className="text-2xl font-bold">{formatPrice(variant?.price ?? product.price)}</p>
      <p className="-mt-4 text-xs text-muted-foreground">Inclusive of all taxes</p>
      {product.variants.length > 1 || product.variants[0]?.color || product.variants[0]?.size ? (
        <VariantPicker variants={product.variants} size={sel.size} color={sel.color} onChange={setSel} />
      ) : null}
      <p className={`text-sm font-medium ${variant?.inStock ? (variant.stock <= 5 ? "text-amber-600" : "text-emerald-600") : "text-destructive"}`} aria-live="polite">
        {stockLabel}
      </p>
      <div className="flex gap-2">
        <Button size="lg" className="flex-1" onClick={onAdd} disabled={!variant?.inStock || state === "adding"} data-testid="add-to-cart">
          {state === "adding" ? <Loader2 className="animate-spin" /> : state === "added" ? <Check /> : <ShoppingBag />}
          {state === "added" ? "Added to cart" : "Add to cart"}
        </Button>
        <Button size="lg" variant="outline" onClick={onWish} aria-pressed={wish} aria-label={wish ? "Remove from wishlist" : "Add to wishlist"}>
          <Heart className={wish ? "fill-red-500 text-red-500" : ""} />
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

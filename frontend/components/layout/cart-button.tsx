"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import { selectCount, useCartStore } from "@/store/cart";

export function CartButton() {
  const count = useCartStore(selectCount);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const n = mounted ? count : 0;
  return (
    <Link href="/cart" className="relative inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-muted" aria-label={`Cart, ${n} item${n === 1 ? "" : "s"}`}>
      <ShoppingBag className="size-5" />
      {n > 0 && (
        <span data-testid="cart-count" className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
          {n}
        </span>
      )}
    </Link>
  );
}

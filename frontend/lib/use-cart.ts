"use client";

import { useCallback } from "react";
import { useSession } from "next-auth/react";
import { api } from "./api";
import type { CartView } from "./types";
import { useCartStore } from "@/store/cart";

/**
 * Cart operations that transparently target the server cart (signed in) or the local guest
 * cart priced through /cart/quote.
 */
export function useCart() {
  const { data: session, status } = useSession();
  const token = session?.accessToken;
  const signedIn = status === "authenticated" && !!token;
  const view = useCartStore((s) => s.view);
  const setView = useCartStore((s) => s.setView);

  const quoteLocal = useCallback(async () => {
    const lines = useCartStore.getState().lines;
    const v = await api<CartView>("/cart/quote", { method: "POST", body: { items: lines } });
    setView(v);
    return v;
  }, [setView]);

  const refresh = useCallback(async () => {
    if (signedIn) {
      const v = await api<CartView>("/cart", { token });
      setView(v);
      return v;
    }
    return quoteLocal();
  }, [signedIn, token, setView, quoteLocal]);

  const add = useCallback(
    async (variantId: string, quantity = 1) => {
      if (signedIn) {
        setView(await api<CartView>("/cart/items", { method: "POST", token, body: { variantId, quantity } }));
        return;
      }
      useCartStore.getState().add(variantId, quantity);
      await quoteLocal();
    },
    [signedIn, token, setView, quoteLocal],
  );

  const setQuantity = useCallback(
    async (variantId: string, quantity: number) => {
      if (signedIn) {
        setView(await api<CartView>(`/cart/items/${variantId}`, { method: "PATCH", token, body: { quantity } }));
        return;
      }
      useCartStore.getState().setQuantity(variantId, quantity);
      await quoteLocal();
    },
    [signedIn, token, setView, quoteLocal],
  );

  const remove = useCallback((variantId: string) => setQuantity(variantId, 0), [setQuantity]);

  return { view, signedIn, token, add, setQuantity, remove, refresh, status };
}

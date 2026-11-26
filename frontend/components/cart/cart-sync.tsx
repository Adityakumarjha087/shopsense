"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api";
import { getSessionId } from "@/lib/session-id";
import type { CartView } from "@/lib/types";
import { useCartStore } from "@/store/cart";

/** Keeps the cart view in sync with the session; merges the guest cart into the server cart on login. */
export function CartSync() {
  const { data: session, status } = useSession();
  const token = session?.accessToken;
  const merged = useRef<string | null>(null);

  useEffect(() => {
    getSessionId();
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    const { lines, setView, clearLocal, setServerSynced } = useCartStore.getState();
    if (status === "authenticated" && token) {
      if (merged.current === token) return;
      merged.current = token;
      const run = lines.length
        ? api<CartView>("/cart/merge", { method: "POST", token, body: { items: lines } }).then((v) => {
            clearLocal();
            return v;
          })
        : api<CartView>("/cart", { token });
      run
        .then((v) => {
          setView(v);
          setServerSynced(true);
        })
        .catch(() => undefined);
    } else {
      merged.current = null;
      setServerSynced(false);
      if (lines.length) api<CartView>("/cart/quote", { method: "POST", body: { items: lines } }).then(setView).catch(() => undefined);
      else setView(null);
    }
  }, [status, token]);

  return null;
}

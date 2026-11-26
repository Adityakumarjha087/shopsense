import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CartView } from "@/lib/types";

export const MAX_LINE_QTY = 10;

export interface LocalLine {
  variantId: string;
  quantity: number;
}

/** Merges line lists by variant, summing quantities and clamping to the per-line maximum. */
export function mergeLines(a: LocalLine[], b: LocalLine[]): LocalLine[] {
  const map = new Map<string, number>();
  for (const l of [...a, ...b]) map.set(l.variantId, Math.min(MAX_LINE_QTY, (map.get(l.variantId) ?? 0) + l.quantity));
  return [...map.entries()].filter(([, q]) => q > 0).map(([variantId, quantity]) => ({ variantId, quantity }));
}

interface CartState {
  /** Guest cart lines (persisted). Signed-in carts live on the server. */
  lines: LocalLine[];
  /** Latest priced view (server cart or guest quote). */
  view: CartView | null;
  /** True once the signed-in user's server cart (after guest merge) has been loaded. */
  serverSynced: boolean;
  setServerSynced: (v: boolean) => void;
  add: (variantId: string, quantity?: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clearLocal: () => void;
  setView: (view: CartView | null) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      view: null,
      serverSynced: false,
      setServerSynced: (serverSynced) => set({ serverSynced }),
      add: (variantId, quantity = 1) => set((s) => ({ lines: mergeLines(s.lines, [{ variantId, quantity }]) })),
      setQuantity: (variantId, quantity) =>
        set((s) => ({
          lines:
            quantity <= 0
              ? s.lines.filter((l) => l.variantId !== variantId)
              : s.lines.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(MAX_LINE_QTY, quantity) } : l)),
        })),
      remove: (variantId) => set((s) => ({ lines: s.lines.filter((l) => l.variantId !== variantId) })),
      clearLocal: () => set({ lines: [] }),
      setView: (view) => set({ view }),
    }),
    { name: "shopsense-cart", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ lines: s.lines }) },
  ),
);

export const selectCount = (s: CartState): number => s.view?.itemCount ?? s.lines.reduce((n, l) => n + l.quantity, 0);

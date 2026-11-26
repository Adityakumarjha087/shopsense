"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import type { AssistantReply, CartAction, CartView, ProductCard } from "@/lib/types";
import { useCartStore } from "@/store/cart";
import { Button } from "@/components/ui/button";

interface Message {
  role: "user" | "assistant";
  content: string;
  products?: ProductCard[];
  comparison?: Array<Record<string, unknown>> | null;
  cartActions?: CartAction[];
  error?: boolean;
}

export const SUGGESTED_PROMPTS = ["Cozy winter outfit under ₹3000", "Compare the first two", "Add the first one to my cart", "Is the first one in stock?"];

/** Applies assistant cart actions: server-persisted ones refresh the server cart, guest ones go to the local store. */
export async function applyCartActions(actions: CartAction[], token: string | undefined) {
  if (!actions.length) return;
  const store = useCartStore.getState();
  const local = actions.filter((a) => !a.persisted);
  for (const a of local) store.add(a.variantId, a.quantity);
  if (actions.some((a) => a.persisted) && token) {
    store.setView(await api<CartView>("/cart", { token }));
  } else if (local.length) {
    store.setView(await api<CartView>("/cart/quote", { method: "POST", body: { items: useCartStore.getState().lines } }));
  }
}

export function ChatWidget({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! I can find products, compare them, check sizes and add things to your cart. What are you shopping for?" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history = [...messages.filter((m) => !m.error), { role: "user" as const, content }];
    setMessages((m) => [...m, { role: "user", content }]);
    setInput("");
    setBusy(true);
    const lastWithProducts = [...messages].reverse().find((m) => m.products?.length);
    // Drop the client-side greeting and keep the window starting with a user turn.
    let windowed = history.slice(1).slice(-10);
    while (windowed[0]?.role === "assistant") windowed = windowed.slice(1);
    try {
      const res = await api<AssistantReply>("/assistant/chat", {
        method: "POST",
        token,
        body: {
          messages: windowed.map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
          shownProducts: (lastWithProducts?.products ?? []).slice(0, 8).map((p) => ({ id: p.id, slug: p.slug, name: p.name, price: p.price })),
        },
      });
      setMessages((m) => [...m, { role: "assistant", content: res.reply, products: res.products, comparison: res.comparison, cartActions: res.cartActions }]);
      await applyCartActions(res.cartActions, token).catch(() => undefined);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 429 ? "You're sending messages too quickly — please wait a moment." : "Sorry, I couldn't reach the assistant. Please try again.";
      setMessages((m) => [...m, { role: "assistant", content: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="assistant-title"
      className="fixed inset-x-2 bottom-2 z-50 flex h-[min(640px,85vh)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[420px]"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id="assistant-title" className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden="true" /> ShopSense Assistant
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close assistant">
          <X />
        </Button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-busy={busy}>
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : m.error ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
              <p className="whitespace-pre-line">{m.content}</p>
              {m.comparison && m.comparison.length > 0 && <ComparisonTable rows={m.comparison} />}
              {m.products && m.products.length > 0 && !m.comparison && (
                <ul className="mt-2 space-y-2" aria-label="Suggested products">
                  {m.products.slice(0, 5).map((p) => (
                    <li key={p.id}>
                      <Link href={`/p/${p.slug}`} className="flex items-center gap-2 rounded-lg bg-background p-2 hover:ring-2 hover:ring-ring" data-testid="assistant-product">
                        {p.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image.url} alt="" width={40} height={40} className="size-10 rounded object-cover" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatPrice(p.price)} · {p.ratingAvg.toFixed(1)}★
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {m.cartActions && m.cartActions.length > 0 && (
                <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  ✓ Cart updated — <Link href="/cart" className="underline">view cart</Link>
                </p>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Thinking…
          </p>
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-border p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTED_PROMPTS.map((p) => (
            <button key={p} type="button" onClick={() => void send(p)} disabled={busy} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
              {p}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <label htmlFor="assistant-input" className="sr-only">
            Message the shopping assistant
          </label>
          <input
            id="assistant-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={2000}
            placeholder="Ask for products, comparisons, stock…"
            className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send message">
            <Send />
          </Button>
        </form>
      </div>
    </section>
  );
}

function ComparisonTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg bg-background">
      <table className="w-full text-left text-xs" data-testid="comparison-table">
        <caption className="sr-only">Product comparison</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="p-2">Product</th>
            <th scope="col" className="p-2">Price</th>
            <th scope="col" className="p-2">Rating</th>
            <th scope="col" className="p-2">Stock</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id)} className="border-b border-border last:border-0">
              <th scope="row" className="p-2 font-medium">{String(r.name)}</th>
              <td className="p-2">{String(r.price_display ?? "")}</td>
              <td className="p-2">{String(r.rating)}★ ({String(r.reviews)})</td>
              <td className="p-2">{r.in_stock ? "In stock" : "Out"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

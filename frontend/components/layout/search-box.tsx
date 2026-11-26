"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { api } from "@/lib/api";

interface Suggestion {
  id: string;
  slug: string;
  name: string;
  category: string;
}

/** Debounced, typo-tolerant autocomplete implemented as an ARIA 1.2 combobox. */
export function SearchBox({ debounceMs = 200 }: { debounceMs?: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      api<{ suggestions: Suggestion[] }>(`/search/suggest?q=${encodeURIComponent(term)}&limit=6`, { signal: ctrl.signal })
        .then((r) => {
          setItems(r.suggestions);
          setActive(-1);
        })
        .catch(() => undefined);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [q, debounceMs]);

  const submit = (term: string) => {
    setOpen(false);
    if (term.trim()) router.push(`/search?q=${encodeURIComponent(term.trim())}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter" && active >= 0 && items[active]) {
      e.preventDefault();
      setOpen(false);
      router.push(`/p/${items[active].slug}`);
    }
  };

  const showList = open && items.length > 0;
  return (
    <form
      role="search"
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        submit(q);
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search products
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        autoComplete="off"
        placeholder="Try “cozy winter outfit under ₹3000”"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-full border border-input bg-muted/50 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label="Suggestions" className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {items.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-4 py-2 text-sm ${i === active ? "bg-muted" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                router.push(`/p/${s.slug}`);
              }}
            >
              <span className="block truncate">{s.name}</span>
              <span className="text-xs text-muted-foreground">{s.category}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

import { randomUUID } from "node:crypto";
import type { EventType, OrderStatus } from "@prisma/client";
import { computeTotals } from "../lib/money.js";
import {
  CATEGORIES,
  CITIES,
  FIRST_NAMES,
  LAST_INITIALS,
  MIXED_TITLES,
  NEGATIVE_SNIPPETS,
  NEGATIVE_TITLES,
  POSITIVE_SNIPPETS,
  POSITIVE_TITLES,
  type CategoryDef,
  type KindDef,
} from "./catalog-data.js";

/** Deterministic PRNG (mulberry32) so the demo dataset is reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
    chance: (p: number) => next() < p,
    shuffle: <T>(arr: T[]): T[] => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    /** Zipf-like index into [0, n): low indices much more likely. */
    zipf: (n: number, s = 1.1) => {
      const weights = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, s));
      const total = weights.reduce((x, y) => x + y, 0);
      let r = next() * total;
      for (let i = 0; i < n; i++) {
        r -= weights[i]!;
        if (r <= 0) return i;
      }
      return n - 1;
    },
  };
}

export type Rng = ReturnType<typeof rng>;

const slugify = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const priceRound = (rupees: number) => Math.max(99, Math.round(rupees / 100) * 100 - 1);

export interface GenVariant {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  priceOverride: number | null;
  stock: number;
  lowStockThreshold: number;
}

export interface GenProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  brand: string;
  categorySlug: string;
  kindKey: string;
  basePrice: number;
  tags: string[];
  attributes: Record<string, string>;
  images: Array<{ url: string; alt: string; position: number }>;
  variants: GenVariant[];
  quality: number;
  popularity: number;
  weakAspect: string;
  createdAt: Date;
}

const APPAREL_SIZES = ["S", "M", "L", "XL"];
const FOOTWEAR_SIZES = ["UK 6", "UK 7", "UK 8", "UK 9", "UK 10"];

function hueFor(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function buildVariants(r: Rng, kind: KindDef, productSlug: string, basePrice: number): GenVariant[] {
  const parts = productSlug.split("-");
  const skuBase = `${parts.slice(0, 2).map((w) => w.slice(0, 3)).join("")}-${parts[parts.length - 1]}`.toUpperCase();
  const colors = kind.colors.length ? r.shuffle(kind.colors).slice(0, kind.variant === "color" ? r.int(2, 3) : r.int(1, 2)) : [];
  const stockFor = () => {
    const roll = r.next();
    if (roll < 0.06) return 0;
    if (roll < 0.16) return r.int(1, 4);
    return r.int(6, 60);
  };
  const out: GenVariant[] = [];
  const mk = (size: string | null, color: string | null, i: number): GenVariant => ({
    id: randomUUID(),
    sku: `${skuBase}-${i.toString().padStart(2, "0")}`,
    size,
    color,
    priceOverride: size === "XL" || size === "UK 10" ? null : null,
    stock: stockFor(),
    lowStockThreshold: 5,
  });
  let i = 0;
  if (kind.variant === "apparel") for (const c of colors) for (const s of APPAREL_SIZES) out.push(mk(s, c, i++));
  else if (kind.variant === "footwear") for (const c of colors) for (const s of FOOTWEAR_SIZES) out.push(mk(s, c, i++));
  else if (kind.variant === "color") for (const c of colors) out.push(mk(null, c, i++));
  else out.push(mk(null, null, i++));
  // A premium colourway on some colour-only products.
  if (kind.variant === "color" && out.length > 1 && r.chance(0.3)) out[out.length - 1]!.priceOverride = Math.round(basePrice * 1.1);
  return out;
}

export function generateProducts(r: Rng, perKind: number): GenProduct[] {
  const products: GenProduct[] = [];
  const now = Date.now();
  for (const cat of CATEGORIES) {
    for (const kind of cat.kinds) {
      const combos = new Set<string>();
      let guard = 0;
      while (combos.size < perKind && guard++ < 500) {
        combos.add(`${r.pick(cat.brands)}|${r.pick(kind.adjectives)}|${r.pick(kind.materials)}`);
      }
      for (const combo of combos) {
        const [brand, adjective, material] = combo.split("|") as [string, string, string];
        const name = kind.key === "novel" ? `${adjective} ${r.pick(["Tide", "Letters", "Garden", "Signal", "Harbour", "Archive"])} (${material})` : `${brand} ${adjective} ${material} ${kind.name}`;
        const slug = `${slugify(name)}-${products.length.toString(36)}`;
        const [lo, hi] = kind.priceRange;
        const basePrice = priceRound(lo + r.next() * (hi - lo)) * 100;
        const attrs: Record<string, string> = { material };
        for (const [k, vals] of Object.entries(kind.attributes)) attrs[k] = r.pick(vals);
        const quality = 3.1 + r.next() * 1.8;
        const hue = hueFor(slug);
        const description = [
          kind.blurb,
          `Made with ${material.toLowerCase()} by ${brand}, this ${adjective.toLowerCase()} ${kind.name.toLowerCase()} is designed for ${kind.tags.slice(0, 3).join(", ")} use.`,
          `Highlights: ${Object.entries(attrs)
            .filter(([k]) => k !== "material")
            .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${v}`)
            .join("; ")}.`,
        ].join(" ");
        products.push({
          id: randomUUID(),
          slug,
          name,
          description,
          brand,
          categorySlug: cat.slug,
          kindKey: kind.key,
          basePrice,
          tags: [...kind.tags],
          attributes: attrs,
          images: [0, 1].map((position) => ({
            url: `/img/p/${cat.slug}/${kind.key}/${(hue + position * 40) % 360}.svg`,
            alt: `${name}${position ? " — alternate view" : ""}`,
            position,
          })),
          variants: buildVariants(r, kind, slug, basePrice),
          quality,
          popularity: r.next(),
          weakAspect: r.pick(kind.aspects.weak),
          createdAt: new Date(now - r.int(1, 240) * 86_400_000),
        });
      }
    }
  }
  return products;
}

export interface GenReview {
  productId: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  createdAt: Date;
}

const kindOf = (p: GenProduct): KindDef => {
  for (const c of CATEGORIES) for (const k of c.kinds) if (k.key === p.kindKey) return k;
  throw new Error(`unknown kind ${p.kindKey}`);
};

export function generateReviews(r: Rng, products: GenProduct[]): GenReview[] {
  const reviews: GenReview[] = [];
  const now = Date.now();
  for (const p of products) {
    const kind = kindOf(p);
    const count = Math.round(2 + p.popularity * p.popularity * 30 + r.int(0, 3));
    for (let i = 0; i < count; i++) {
      const rating = Math.max(1, Math.min(5, Math.round(p.quality + (r.next() - 0.5) * 2.2)));
      const strong = r.shuffle(kind.aspects.strong);
      const pos = (a: string) => r.pick(POSITIVE_SNIPPETS[a] ?? POSITIVE_SNIPPETS.quality!);
      const neg = (a: string) => r.pick(NEGATIVE_SNIPPETS[a] ?? NEGATIVE_SNIPPETS.quality!);
      let parts: string[];
      let title: string;
      if (rating >= 4) {
        parts = [pos(strong[0]!), pos(strong[1]!)];
        if (r.chance(0.35)) parts.push(`Only downside: ${neg(p.weakAspect).toLowerCase()}`);
        title = r.pick(POSITIVE_TITLES);
      } else if (rating === 3) {
        parts = [pos(strong[0]!), `But ${neg(p.weakAspect).toLowerCase()}`];
        title = r.pick(MIXED_TITLES);
      } else {
        parts = [neg(p.weakAspect), neg(r.pick(kind.aspects.weak))];
        if (r.chance(0.4)) parts.push(neg("value"));
        title = r.pick(NEGATIVE_TITLES);
      }
      if (r.chance(0.15)) parts.push(rating >= 3 ? pos("delivery") : neg("delivery"));
      reviews.push({
        productId: p.id,
        authorName: `${r.pick(FIRST_NAMES)} ${r.pick(LAST_INITIALS)}`,
        rating,
        title,
        body: [...new Set(parts)].join(" "),
        createdAt: new Date(now - r.int(1, 200) * 86_400_000),
      });
    }
  }
  return reviews;
}

export interface GenUser {
  id: string;
  email: string;
  name: string;
  favouriteCategories: string[];
  priceTier: number; // 0 budget .. 1 premium
}

export function generateUsers(r: Rng, n: number): GenUser[] {
  return Array.from({ length: n }, (_, i) => {
    const cats = r.shuffle(CATEGORIES.map((c) => c.slug));
    return {
      id: randomUUID(),
      email: `shopper${i + 1}@example.test`,
      name: `${r.pick(FIRST_NAMES)} ${r.pick(LAST_INITIALS)}`,
      favouriteCategories: cats.slice(0, r.chance(0.5) ? 1 : 2),
      priceTier: r.next(),
    };
  });
}

export interface GenEvent {
  userId: string | null;
  sessionId: string;
  type: EventType;
  productId: string;
  createdAt: Date;
}

export interface GenOrder {
  id: string;
  userId: string;
  status: OrderStatus;
  createdAt: Date;
  items: Array<{ productId: string; variantId: string; name: string; sku: string; unitPrice: number; quantity: number }>;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  address: Record<string, string>;
}

/**
 * Simulates browsing sessions with latent preferences: users favour 1–2 categories, a
 * price tier and (within a category) a popularity-skewed subset of products. Purchases
 * create delivered orders; complementary kinds are frequently bought together so the
 * association-rule miner has real structure to find.
 */
export function generateInteractions(r: Rng, users: GenUser[], products: GenProduct[], days = 120) {
  const byCategory = new Map<string, GenProduct[]>();
  for (const p of products) {
    const list = byCategory.get(p.categorySlug) ?? [];
    list.push(p);
    byCategory.set(p.categorySlug, list);
  }
  for (const list of byCategory.values()) list.sort((a, b) => b.popularity - a.popularity);
  const byKind = new Map<string, GenProduct[]>();
  for (const p of products) {
    const list = byKind.get(p.kindKey) ?? [];
    list.push(p);
    byKind.set(p.kindKey, list);
  }
  // Each product has a stable "partner" per complementary kind (bought together often).
  const partners = new Map<string, string[]>();
  for (const p of products) {
    const kind = kindOf(p);
    const ids: string[] = [];
    for (const ck of kind.complements ?? []) {
      const options = byKind.get(ck);
      if (options?.length) ids.push(options[hueFor(p.slug + ck) % Math.min(3, options.length)]!.id);
    }
    partners.set(p.id, ids);
  }
  const byId = new Map(products.map((p) => [p.id, p]));
  const allCats = CATEGORIES.map((c: CategoryDef) => c.slug);

  const events: GenEvent[] = [];
  const orders: GenOrder[] = [];
  const now = Date.now();

  for (const u of users) {
    const sessions = r.int(3, 14);
    for (let s = 0; s < sessions; s++) {
      const sessionId = `seed-${u.id.slice(0, 8)}-${s}`;
      let t = now - r.int(1, days) * 86_400_000 - r.int(0, 86_000) * 1000;
      const cat = r.chance(0.85) ? r.pick(u.favouriteCategories) : r.pick(allCats);
      const pool = byCategory.get(cat)!;
      // Price-tier affinity: re-rank the pool towards the user's tier, keep popularity skew.
      const ranked = [...pool].sort((a, b) => {
        const ta = Math.abs(a.basePrice / 1_000_000 - u.priceTier);
        const tb = Math.abs(b.basePrice / 1_000_000 - u.priceTier);
        return ta - tb + (b.popularity - a.popularity) * 0.6;
      });
      const views = r.int(2, 7);
      const viewed: GenProduct[] = [];
      for (let v = 0; v < views; v++) {
        const p = ranked[r.zipf(ranked.length, 0.9)]!;
        viewed.push(p);
        events.push({ userId: u.id, sessionId, type: "VIEW", productId: p.id, createdAt: new Date(t) });
        t += r.int(20, 180) * 1000;
      }
      const carted: GenProduct[] = [];
      for (const p of new Set(viewed)) {
        if (r.chance(0.28)) {
          carted.push(p);
          events.push({ userId: u.id, sessionId, type: "ADD_TO_CART", productId: p.id, createdAt: new Date(t) });
          t += r.int(10, 60) * 1000;
        } else if (r.chance(0.06)) {
          events.push({ userId: u.id, sessionId, type: "WISHLIST", productId: p.id, createdAt: new Date(t) });
        }
      }
      if (carted.length && r.chance(0.55)) {
        const basket = [...carted];
        for (const p of carted) {
          for (const partnerId of partners.get(p.id) ?? []) {
            if (r.chance(0.45)) {
              const partner = byId.get(partnerId)!;
              if (!basket.includes(partner)) {
                basket.push(partner);
                events.push({ userId: u.id, sessionId, type: "ADD_TO_CART", productId: partner.id, createdAt: new Date(t) });
              }
            }
          }
        }
        t += r.int(60, 300) * 1000;
        const items = basket.map((p) => {
          const v = r.pick(p.variants);
          return { productId: p.id, variantId: v.id, name: p.name, sku: v.sku, unitPrice: v.priceOverride ?? p.basePrice, quantity: r.chance(0.12) ? 2 : 1 };
        });
        const totals = computeTotals(items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0));
        const ageDays = (now - t) / 86_400_000;
        const status: OrderStatus = ageDays > 7 ? "DELIVERED" : ageDays > 2 ? "SHIPPED" : "PAID";
        const [city, state, pin] = r.pick(CITIES);
        orders.push({
          id: randomUUID(),
          userId: u.id,
          status,
          createdAt: new Date(t),
          items,
          ...totals,
          address: { fullName: u.name, line1: `${r.int(1, 300)} Demo Street`, line2: "", city, state, postalCode: pin, phone: "9000000000" },
        });
        for (const p of basket) events.push({ userId: u.id, sessionId, type: "PURCHASE", productId: p.id, createdAt: new Date(t) });
      }
    }
  }
  return { events, orders };
}

import type { ProductCard, Variant } from "@/lib/types";

export const product = (over: Partial<ProductCard> = {}): ProductCard => ({
  id: "p1",
  slug: "northloom-classic-merino-wool-sweater-1",
  name: "Northloom Classic Merino Wool Sweater",
  brand: "Northloom",
  price: 249900,
  currency: "INR",
  image: { url: "/img/p/mens-clothing/sweater/10.svg", alt: "Sweater" },
  ratingAvg: 4.3,
  ratingCount: 21,
  category: { slug: "mens-clothing", name: "Men's Clothing" },
  inStock: true,
  colors: ["Navy"],
  ...over,
});

export const variants: Variant[] = [
  { id: "v1", sku: "A-1", size: "S", color: "Navy", price: 249900, stock: 0, inStock: false },
  { id: "v2", sku: "A-2", size: "M", color: "Navy", price: 249900, stock: 4, inStock: true },
  { id: "v3", sku: "A-3", size: "L", color: "Navy", price: 249900, stock: 9, inStock: true },
  { id: "v4", sku: "A-4", size: "S", color: "Olive", price: 249900, stock: 0, inStock: false },
  { id: "v5", sku: "A-5", size: "M", color: "Olive", price: 249900, stock: 0, inStock: false },
];

export function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = handler(url, init);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

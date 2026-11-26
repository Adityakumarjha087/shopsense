import type { Metadata } from "next";
import Link from "next/link";
import { serverFetch } from "@/lib/server-api";
import type { Category, SearchResult } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { first, qs, rupeeParam, type SearchParams } from "@/lib/query";
import { ProductGrid } from "@/components/product/product-card";
import { Pagination } from "@/components/product/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";

type Props = { searchParams: Promise<SearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = first((await searchParams).q) ?? "";
  return { title: q ? `Search: ${q}` : "Search", robots: { index: false } };
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = first(sp.q) ?? "";
  const category = first(sp.category);
  const min = first(sp.min);
  const max = first(sp.max);
  const minRating = first(sp.rating);
  const inStock = first(sp.inStock) === "true" ? "true" : undefined;
  const sort = first(sp.sort) ?? "relevance";
  const page = Math.max(1, Number(first(sp.page) ?? 1) || 1);

  const [result, categories] = await Promise.all([
    serverFetch<SearchResult>(
      `/search${qs({ q, category, minPrice: rupeeParam(min), maxPrice: rupeeParam(max), minRating, inStock, sort, page, pageSize: 24 })}`,
      { revalidate: 30 },
    ),
    serverFetch<Category[]>("/categories", { revalidate: 600, tags: ["categories"] }),
  ]);
  const catName = new Map((categories ?? []).map((c) => [c.slug, c.name]));
  const totalPages = result ? Math.ceil(result.total / result.pageSize) : 0;
  const parsed = result?.parsed;
  const facetCats = Object.entries(result?.facets.category ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside aria-label="Search filters">
        <form method="get" className="space-y-4 rounded-xl border border-border bg-card p-4">
          <input type="hidden" name="q" value={q} />
          <label className="flex flex-col gap-1 text-sm">
            Category
            <NativeSelect name="category" defaultValue={category ?? ""}>
              <option value="">All categories</option>
              {(categories ?? []).map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </NativeSelect>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Min ₹
              <Input name="min" type="number" min={0} defaultValue={min} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Max ₹
              <Input name="max" type="number" min={0} defaultValue={max} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Minimum rating
            <NativeSelect name="rating" defaultValue={minRating ?? ""}>
              <option value="">Any</option>
              <option value="4">4★ & up</option>
              <option value="3">3★ & up</option>
            </NativeSelect>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="inStock" value="true" defaultChecked={!!inStock} className="size-4" /> In stock only
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Sort
            <NativeSelect name="sort" defaultValue={sort}>
              <option value="relevance">Relevance</option>
              <option value="rating">Top rated</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="newest">Newest</option>
            </NativeSelect>
          </label>
          <Button type="submit" className="w-full">Apply filters</Button>
        </form>
      </aside>
      <section aria-labelledby="results" className="space-y-4">
        <div className="space-y-2">
          <h1 id="results" className="text-2xl font-bold">{q ? <>Results for “{q}”</> : "All products"}</h1>
          {parsed && (parsed.maxPrice !== undefined || parsed.minPrice !== undefined || parsed.inStock) && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              Understood:
              {parsed.text && <Badge variant="outline">“{parsed.text}”</Badge>}
              {parsed.minPrice !== undefined && <Badge variant="secondary">Min {formatPrice(parsed.minPrice)} detected</Badge>}
              {parsed.maxPrice !== undefined && <Badge variant="secondary">Max {formatPrice(parsed.maxPrice)} detected</Badge>}
              {parsed.inStock && <Badge variant="secondary">In stock</Badge>}
            </p>
          )}
          {result && (
            <p className="text-sm text-muted-foreground">
              {result.total} results · {result.engines.semantic ? "keyword + semantic (hybrid)" : "keyword"} search
            </p>
          )}
          {facetCats.length > 1 && (
            <ul className="flex flex-wrap gap-2" aria-label="Refine by category">
              {facetCats.slice(0, 8).map(([slug, n]) => (
                <li key={slug}>
                  <Link href={`/search${qs({ q, category: slug, min, max, rating: minRating, inStock, sort })}`} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">
                    {catName.get(slug) ?? slug} ({n})
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!result ? (
          <p role="alert" className="text-muted-foreground">Search is temporarily unavailable. Please try again.</p>
        ) : result.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="font-medium">No products found</p>
            <p className="text-sm text-muted-foreground">Try fewer words, a higher budget, or ask the AI assistant.</p>
          </div>
        ) : (
          <>
            <ProductGrid products={result.items} priorityCount={4} headingLevel={2} />
            <Pagination page={page} totalPages={totalPages} hrefFor={(p) => `/search${qs({ q, category, min, max, rating: minRating, inStock, sort, page: p })}`} />
          </>
        )}
      </section>
    </div>
  );
}

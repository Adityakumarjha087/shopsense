import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import type { Category, Paged, ProductCard } from "@/lib/types";
import { first, qs, rupeeParam, type SearchParams } from "@/lib/query";
import { ProductGrid } from "@/components/product/product-card";
import { Pagination } from "@/components/product/pagination";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> };

const SORTS = [
  ["popular", "Most popular"],
  ["rating", "Top rated"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["newest", "Newest"],
] as const;

async function getCategory(slug: string) {
  const cats = await serverFetch<Category[]>("/categories", { revalidate: 600, tags: ["categories"] });
  return cats?.find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const cat = await getCategory(slug);
  return { title: cat?.name ?? "Category", description: cat?.description };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const sort = first(sp.sort) ?? "popular";
  const page = Math.max(1, Number(first(sp.page) ?? 1) || 1);
  const min = first(sp.min);
  const max = first(sp.max);
  const [category, data] = await Promise.all([
    getCategory(slug),
    serverFetch<Paged<ProductCard>>(
      `/products${qs({ category: slug, sort, page, pageSize: 24, minPrice: rupeeParam(min), maxPrice: rupeeParam(max) })}`,
      { revalidate: 120, tags: ["catalog"] },
    ),
  ]);
  if (!category && data && data.total === 0) notFound();
  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{category?.name ?? slug}</h1>
        {category?.description && <p className="text-muted-foreground">{category.description}</p>}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4" aria-label="Filter products">
        <label className="flex flex-col gap-1 text-sm">
          Sort by
          <NativeSelect name="sort" defaultValue={sort}>
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Min price (₹)
          <Input name="min" type="number" min={0} inputMode="numeric" defaultValue={min} className="w-28" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Max price (₹)
          <Input name="max" type="number" min={0} inputMode="numeric" defaultValue={max} className="w-28" />
        </label>
        <Button type="submit">Apply</Button>
      </form>
      {!data ? (
        <p role="alert" className="text-muted-foreground">We couldn’t load products right now. Please try again shortly.</p>
      ) : data.items.length === 0 ? (
        <p className="text-muted-foreground">No products match these filters.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{data.total} products</p>
          <ProductGrid products={data.items} priorityCount={4} headingLevel={2} />
          <Pagination page={page} totalPages={totalPages} hrefFor={(p) => `/c/${slug}${qs({ sort, min, max, page: p })}`} />
        </>
      )}
    </div>
  );
}

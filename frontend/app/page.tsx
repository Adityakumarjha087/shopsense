import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { serverFetch } from "@/lib/server-api";
import type { Category, Paged, ProductCard } from "@/lib/types";
import { ProductGrid } from "@/components/product/product-card";
import { RecommendedForYou } from "@/components/home/recommended";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [categories, popular] = await Promise.all([
    serverFetch<Category[]>("/categories", { revalidate: 600, tags: ["categories"] }),
    serverFetch<Paged<ProductCard>>("/products?sort=popular&pageSize=10", { revalidate: 120, tags: ["catalog"] }),
  ]);
  return (
    <div className="space-y-12">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-12 text-white sm:px-10 sm:py-16">
        <div className="max-w-xl space-y-4">
          <p className="text-sm font-medium uppercase tracking-wider text-white/80">Winter edit is here</p>
          <h1 className="text-3xl font-bold leading-tight sm:text-5xl">Shopping that understands you.</h1>
          <p className="text-white/90">Personalised picks from our recommender, search that gets “cozy winter outfit under ₹3000”, and an AI assistant that can compare and add to cart for you.</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-white text-indigo-700 hover:bg-white/90">
              <Link href="/search?q=cozy%20winter%20outfit%20under%20%E2%82%B93000">
                Shop the winter edit <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {categories && categories.length > 0 && (
        <section aria-labelledby="cats" className="space-y-3">
          <h2 id="cats" className="text-xl font-semibold">Shop by category</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.slug}`} className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary">
                  <span className="block font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.productCount} products</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RecommendedForYou />

      <section aria-labelledby="popular" className="space-y-3">
        <h2 id="popular" className="text-xl font-semibold">Popular right now</h2>
        {popular?.items.length ? <ProductGrid products={popular.items} priorityCount={2} /> : <p className="text-sm text-muted-foreground">Products are loading — please refresh in a moment.</p>}
      </section>
    </div>
  );
}

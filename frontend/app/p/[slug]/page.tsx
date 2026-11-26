import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import type { ProductDetail, RecResponse } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { Gallery } from "@/components/product/gallery";
import { PurchasePanel } from "@/components/product/purchase-panel";
import { Rating } from "@/components/product/rating";
import { ReviewSummaryCard } from "@/components/product/review-summary";
import { Reviews } from "@/components/product/reviews";
import { ProductGrid } from "@/components/product/product-card";
import { ViewTracker } from "@/components/product/view-tracker";
import { AddAllButton } from "@/components/product/add-all-button";

// ISR: pages are generated on first request and revalidated every 5 minutes (or on demand via /api/revalidate).
export const revalidate = 300;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

const getProduct = (slug: string) => serverFetch<ProductDetail>(`/products/${encodeURIComponent(slug)}`, { revalidate: 300, tags: [`product:${slug}`, "catalog"] });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProduct(slug);
  if (!p) return { title: "Product not found" };
  return {
    title: p.name,
    description: p.description.slice(0, 160),
    openGraph: { title: p.name, description: p.description.slice(0, 160), images: p.images[0] ? [p.images[0].url] : [] },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const [similar, fbt] = await Promise.all([
    serverFetch<RecResponse>(`/recommendations/similar/${product.id}?k=10`, { revalidate: 600, tags: [`product:${slug}`] }),
    serverFetch<RecResponse>(`/recommendations/bought-together/${product.id}?k=3`, { revalidate: 600, tags: [`product:${slug}`] }),
  ]);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    brand: { "@type": "Brand", name: product.brand },
    description: product.description,
    image: product.images.map((i) => i.url),
    sku: product.variants[0]?.sku,
    aggregateRating: product.ratingCount ? { "@type": "AggregateRating", ratingValue: product.ratingAvg, reviewCount: product.ratingCount } : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: (product.price / 100).toFixed(2),
      availability: product.variants.some((v) => v.inStock) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <div className="space-y-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ViewTracker productId={product.id} />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Home</Link> /{" "}
        <Link href={`/c/${product.category.slug}`} className="hover:text-foreground">{product.category.name}</Link>
      </nav>
      <div className="grid gap-8 md:grid-cols-2">
        <Gallery images={product.images} name={product.name} />
        <div className="space-y-5">
          <div>
            <p className="text-sm text-muted-foreground">{product.brand}</p>
            <h1 className="text-2xl font-bold sm:text-3xl">{product.name}</h1>
            <Rating value={product.ratingAvg} count={product.ratingCount} className="mt-2" />
          </div>
          <PurchasePanel product={product} />
          <ReviewSummaryCard productId={product.id} initial={product.reviewSummary} />
          <div>
            <h2 className="mb-2 font-semibold">About this item</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>
            {Object.keys(product.attributes).length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {Object.entries(product.attributes).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="capitalize text-muted-foreground">{k.replace(/([A-Z])/g, " $1")}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </div>

      {fbt && fbt.items.length > 0 && (
        <section aria-labelledby="fbt" className="space-y-3 rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="fbt" className="text-xl font-semibold">Frequently bought together</h2>
            <AddAllButton slugs={fbt.items.map((i) => i.slug)} />
          </div>
          <p className="text-sm text-muted-foreground">
            Bundle total with this item: {formatPrice(product.price + fbt.items.reduce((s, i) => s + i.price, 0))}
          </p>
          <ProductGrid products={fbt.items} />
        </section>
      )}

      {similar && similar.items.length > 0 && (
        <section aria-labelledby="similar" className="space-y-3">
          <h2 id="similar" className="text-xl font-semibold">Similar items</h2>
          <ProductGrid products={similar.items} />
        </section>
      )}

      <Reviews productId={product.id} ratingAvg={product.ratingAvg} />
    </div>
  );
}

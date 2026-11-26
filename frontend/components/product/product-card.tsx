import Link from "next/link";
import type { ProductCard as ProductCardData } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { Rating } from "./rating";

interface Props {
  product: ProductCardData;
  /** Optional click hook (recommendation click attribution). */
  onSelect?: (product: ProductCardData) => void;
  priority?: boolean;
  /** Heading level for the product name (keeps the document outline valid). */
  headingLevel?: 2 | 3;
}

export function ProductCard({ product, onSelect, priority, headingLevel = 3 }: Props) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md">
      <div className="aspect-square overflow-hidden bg-muted">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image.url}
            alt={product.image.alt}
            width={400}
            height={400}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-xs text-muted-foreground">{product.brand}</p>
        <Heading className="line-clamp-2 text-sm font-medium leading-snug">
          <Link href={`/p/${product.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none" onClick={onSelect ? () => onSelect(product) : undefined}>
            {product.name}
          </Link>
        </Heading>
        <Rating value={product.ratingAvg} count={product.ratingCount} className="text-xs" />
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="font-semibold">{formatPrice(product.price)}</span>
          {!product.inStock && <span className="text-xs font-medium text-destructive">Out of stock</span>}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  onSelect,
  priorityCount = 0,
  headingLevel,
}: {
  products: ProductCardData[];
  onSelect?: Props["onSelect"];
  priorityCount?: number;
  headingLevel?: 2 | 3;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5" role="list">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} onSelect={onSelect} priority={i < priorityCount} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

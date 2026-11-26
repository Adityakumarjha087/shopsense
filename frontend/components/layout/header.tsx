import Link from "next/link";
import { Suspense } from "react";
import { Heart, Sparkles } from "lucide-react";
import type { Category } from "@/lib/types";
import { serverFetch } from "@/lib/server-api";
import { SearchBox } from "./search-box";
import { CartButton } from "./cart-button";
import { AccountMenu } from "./account-menu";
import { ThemeToggle } from "./theme-toggle";

export async function Header() {
  const categories = (await serverFetch<Category[]>("/categories", { revalidate: 60, tags: ["categories"] })) ?? [];
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-1.5 text-lg font-bold tracking-tight" aria-label="ShopSense home">
          <Sparkles className="size-5 text-primary" aria-hidden="true" />
          <span>ShopSense</span>
        </Link>
        <div className="mx-2 hidden flex-1 md:block">
          <Suspense fallback={<div className="h-10 rounded-full bg-muted" />}>
            <SearchBox />
          </Suspense>
        </div>
        <nav aria-label="Account" className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Link href="/wishlist" aria-label="Wishlist" className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-muted">
            <Heart className="size-5" />
          </Link>
          <CartButton />
          <AccountMenu />
        </nav>
      </div>
      <div className="px-4 pb-3 md:hidden">
        <Suspense fallback={<div className="h-10 rounded-full bg-muted" />}>
          <SearchBox />
        </Suspense>
      </div>
      {categories.length > 0 && (
        <nav aria-label="Categories" className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2">
          <ul className="flex gap-4 whitespace-nowrap text-sm text-muted-foreground">
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.slug}`} className="hover:text-foreground">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

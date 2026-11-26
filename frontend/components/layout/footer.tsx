import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 text-sm text-muted-foreground sm:grid-cols-3">
        <div>
          <p className="font-semibold text-foreground">ShopSense</p>
          <p className="mt-2">AI-powered shopping demo with ML recommendations, semantic search and a shopping assistant. All products are synthetic.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="space-y-2">
            <li><Link href="/search?q=winter" className="hover:text-foreground">Winter collection</Link></li>
            <li><Link href="/orders" className="hover:text-foreground">Your orders</Link></li>
            <li><Link href="/cart" className="hover:text-foreground">Cart</Link></li>
          </ul>
        </nav>
        <p>Prices in INR, GST included. Payments run in test mode.</p>
      </div>
    </footer>
  );
}

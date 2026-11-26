import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav aria-label="Admin" className="flex gap-4 border-b border-border pb-3 text-sm">
        <Link href="/admin" className="font-medium hover:text-primary">Dashboard</Link>
        <Link href="/admin/products" className="font-medium hover:text-primary">Products</Link>
        <Link href="/admin/orders" className="font-medium hover:text-primary">Orders</Link>
      </nav>
      {children}
    </div>
  );
}

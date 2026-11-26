"use client";

import Link from "next/link";
import { useState } from "react";
import { useAdminQuery } from "@/lib/use-admin";
import { formatPrice } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Row {
  id: string;
  slug: string;
  name: string;
  brand: string;
  basePrice: number;
  isActive: boolean;
  category: { name: string };
  totalStock: number;
  variantCount: number;
}

export function AdminProducts() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const { data, error } = useAdminQuery<{ items: Row[]; total: number; pageSize: number }>(`/admin/products?page=${page}&pageSize=25${term ? `&q=${encodeURIComponent(term)}` : ""}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Products</h1>
        <Button asChild><Link href="/admin/products/new">New product</Link></Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setTerm(q);
        }}
      >
        <label htmlFor="admin-q" className="sr-only">Search products</label>
        <Input id="admin-q" placeholder="Search by name or brand" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th scope="col" className="p-3">Name</th>
              <th scope="col">Category</th>
              <th scope="col">Price</th>
              <th scope="col">Stock</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="p-3">
                  <Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                  <span className="block text-xs text-muted-foreground">{p.brand} · {p.variantCount} variants</span>
                </td>
                <td>{p.category.name}</td>
                <td>{formatPrice(p.basePrice)}</td>
                <td>{p.totalStock}</td>
                <td><Badge variant={p.isActive ? "success" : "secondary"}>{p.isActive ? "Active" : "Archived"}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
          <Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

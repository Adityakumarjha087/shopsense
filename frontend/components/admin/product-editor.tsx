"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAdminApi, useAdminQuery } from "@/lib/use-admin";
import type { Category } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AdminVariant {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  stock: number;
  priceOverride: number | null;
  lowStockThreshold: number;
}

interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  brand: string;
  categoryId: string;
  basePrice: number;
  tags: string[];
  isActive: boolean;
  variants: AdminVariant[];
}

export function ProductEditor({ id }: { id: string | null }) {
  const router = useRouter();
  const { call } = useAdminApi();
  const existing = useAdminQuery<AdminProduct>(id ? `/admin/products/${id}` : null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ name: "", description: "", brand: "", categoryId: "", price: "", tags: "", isActive: true });
  const [newVariant, setNewVariant] = useState({ sku: "", size: "", color: "", stock: "10" });
  const [stock, setStock] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<Category[]>("/categories").then(setCategories).catch(() => undefined);
  }, []);
  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setForm({ name: p.name, description: p.description, brand: p.brand, categoryId: p.categoryId, price: String(p.basePrice / 100), tags: p.tags.join(", "), isActive: p.isActive });
    setStock(Object.fromEntries(p.variants.map((v) => [v.id, String(v.stock)])));
  }, [existing.data]);

  const payload = () => ({
    name: form.name,
    description: form.description,
    brand: form.brand,
    categoryId: form.categoryId,
    basePrice: Math.round(Number(form.price) * 100),
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    isActive: form.isActive,
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      if (id) {
        await call(`/admin/products/${id}`, { method: "PATCH", body: payload() });
        setMsg("Saved");
      } else {
        const created = await call<{ id: string }>("/admin/products", {
          method: "POST",
          body: {
            ...payload(),
            variants: [{ sku: newVariant.sku, size: newVariant.size || null, color: newVariant.color || null, stock: Number(newVariant.stock) || 0 }],
          },
        });
        router.push(`/admin/products/${created.id}`);
      }
    } catch (err) {
      setMsg(err instanceof ApiError ? `${err.message}${Array.isArray(err.details) ? `: ${(err.details as Array<{ path: string; message: string }>).map((d) => `${d.path} ${d.message}`).join("; ")}` : ""}` : "Save failed");
    }
  };

  const saveStock = async (variantId: string) => {
    try {
      await call(`/admin/variants/${variantId}`, { method: "PATCH", body: { stock: Number(stock[variantId]) } });
      setMsg("Stock updated");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Update failed");
    }
  };

  const archive = async () => {
    if (!id || !confirm("Archive this product? It will be hidden from the store.")) return;
    await call(`/admin/products/${id}`, { method: "DELETE" });
    router.push("/admin/products");
  };

  if (id && !existing.data && !existing.error) return <p role="status">Loading…</p>;
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">{id ? "Edit product" : "New product"}</h1>
      {existing.error && <p role="alert" className="text-destructive">{existing.error}</p>}
      <form onSubmit={save} className="space-y-4">
        <div><Label htmlFor="p-name">Name</Label><Input id="p-name" required minLength={3} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" /></div>
        <div><Label htmlFor="p-brand">Brand</Label><Input id="p-brand" required value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="mt-1" /></div>
        <div>
          <Label htmlFor="p-cat">Category</Label>
          <NativeSelect id="p-cat" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="mt-1 w-full">
            <option value="">Select…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <div><Label htmlFor="p-price">Base price (₹)</Label><Input id="p-price" type="number" min={1} step="0.01" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="mt-1" /></div>
        <div><Label htmlFor="p-desc">Description</Label><Textarea id="p-desc" required minLength={10} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" /></div>
        <div><Label htmlFor="p-tags">Tags (comma separated)</Label><Input id="p-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="mt-1" /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
        {!id && (
          <fieldset className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 sm:grid-cols-4">
            <legend className="px-1 text-sm font-medium">First variant</legend>
            <div><Label htmlFor="v-sku">SKU</Label><Input id="v-sku" required minLength={3} value={newVariant.sku} onChange={(e) => setNewVariant({ ...newVariant, sku: e.target.value })} /></div>
            <div><Label htmlFor="v-size">Size</Label><Input id="v-size" value={newVariant.size} onChange={(e) => setNewVariant({ ...newVariant, size: e.target.value })} /></div>
            <div><Label htmlFor="v-color">Colour</Label><Input id="v-color" value={newVariant.color} onChange={(e) => setNewVariant({ ...newVariant, color: e.target.value })} /></div>
            <div><Label htmlFor="v-stock">Stock</Label><Input id="v-stock" type="number" min={0} value={newVariant.stock} onChange={(e) => setNewVariant({ ...newVariant, stock: e.target.value })} /></div>
          </fieldset>
        )}
        <div className="flex gap-2">
          <Button type="submit">{id ? "Save changes" : "Create product"}</Button>
          {id && <Button type="button" variant="destructive" onClick={archive}>Archive</Button>}
        </div>
        {msg && <p role="status" className="text-sm">{msg}</p>}
      </form>
      {existing.data && (
        <section aria-labelledby="variants" className="space-y-2">
          <h2 id="variants" className="font-semibold">Variants & inventory</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground"><tr><th scope="col" className="py-2">SKU</th><th scope="col">Option</th><th scope="col">Stock</th><th /></tr></thead>
            <tbody>
              {existing.data.variants.map((v) => (
                <tr key={v.id} className="border-t border-border">
                  <td className="py-2">{v.sku}</td>
                  <td>{[v.size, v.color].filter(Boolean).join(" / ") || "—"}</td>
                  <td>
                    <label className="sr-only" htmlFor={`stock-${v.id}`}>Stock for {v.sku}</label>
                    <Input id={`stock-${v.id}`} type="number" min={0} className="h-8 w-24" value={stock[v.id] ?? ""} onChange={(e) => setStock({ ...stock, [v.id]: e.target.value })} />
                  </td>
                  <td><Button size="sm" variant="outline" onClick={() => saveStock(v.id)}>Update</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

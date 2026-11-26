"use client";

import { useState } from "react";
import { useCartStore } from "@/store/cart";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/use-cart";
import type { Order } from "@/lib/types";
import { EMPTY_ADDRESS, luhnValid, validateAddress, type Address } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TotalsBox } from "./totals";
import dynamic from "next/dynamic";

const StripePayment = dynamic(() => import("./stripe-payment").then((m) => m.StripePayment), { ssr: false });

interface CheckoutResponse {
  order: Order;
  payment: { mode: "stripe" | "mock"; clientSecret: string; intentId: string };
}

const FIELDS: Array<{ key: keyof Address; label: string; autoComplete: string; optional?: boolean; inputMode?: "numeric" | "tel" }> = [
  { key: "fullName", label: "Full name", autoComplete: "name" },
  { key: "line1", label: "Address line 1", autoComplete: "address-line1" },
  { key: "line2", label: "Address line 2", autoComplete: "address-line2", optional: true },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "state", label: "State", autoComplete: "address-level1" },
  { key: "postalCode", label: "PIN code", autoComplete: "postal-code", inputMode: "numeric" },
  { key: "phone", label: "Phone", autoComplete: "tel", inputMode: "tel" },
];

export function Checkout({ stripePublishableKey }: { stripePublishableKey: string | null }) {
  const { view, token, status } = useCart();
  const synced = useCartStore((st) => st.serverSynced);
  const router = useRouter();
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [errors, setErrors] = useState<Partial<Record<keyof Address, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateAddress(address);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      const { line2, ...rest } = address;
      const res = await api<CheckoutResponse>("/checkout", { method: "POST", token, body: { shippingAddress: { ...rest, ...(line2.trim() ? { line2 } : {}) } } });
      setCheckout(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the order");
    } finally {
      setBusy(false);
    }
  };

  if (checkout) {
    const useStripe = checkout.payment.mode === "stripe" && !!stripePublishableKey;
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <h1 className="text-2xl font-bold">Payment</h1>
        <p className="text-sm text-muted-foreground">Order {checkout.order.id} · total {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(checkout.order.total / 100)}</p>
        {useStripe ? (
          <StripePayment publishableKey={stripePublishableKey!} clientSecret={checkout.payment.clientSecret} orderId={checkout.order.id} />
        ) : (
          <MockPayment orderId={checkout.order.id} token={token} onDone={(id) => router.push(`/orders/${id}`)} />
        )}
      </div>
    );
  }

  if (status === "loading" || !synced || !view) return <p role="status" className="py-10 text-center text-muted-foreground">Loading checkout…</p>;
  if (view.items.length === 0) return <p className="py-10 text-center text-muted-foreground">Your cart is empty.</p>;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <form onSubmit={placeOrder} noValidate className="space-y-4" aria-labelledby="shipping-title">
        <h1 id="shipping-title" className="text-2xl font-bold">Shipping address</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.key === "line1" || f.key === "line2" || f.key === "fullName" ? "sm:col-span-2" : ""}>
              <Label htmlFor={`addr-${f.key}`}>
                {f.label}
                {f.optional && <span className="text-muted-foreground"> (optional)</span>}
              </Label>
              <Input
                id={`addr-${f.key}`}
                name={f.key}
                autoComplete={f.autoComplete}
                inputMode={f.inputMode}
                value={address[f.key]}
                aria-invalid={!!errors[f.key]}
                aria-describedby={errors[f.key] ? `addr-${f.key}-err` : undefined}
                onChange={(e) => setAddress({ ...address, [f.key]: e.target.value })}
                className="mt-1"
              />
              {errors[f.key] && <p id={`addr-${f.key}-err`} className="mt-1 text-xs text-destructive">{errors[f.key]}</p>}
            </div>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={busy} data-testid="place-order">
          {busy && <Loader2 className="animate-spin" />} Continue to payment
        </Button>
      </form>
      <aside className="h-fit space-y-3 rounded-xl border border-border bg-card p-5" aria-label="Order summary">
        <h2 className="font-semibold">{view.itemCount} item(s)</h2>
        <ul className="space-y-1 text-sm">
          {view.items.map((l) => (
            <li key={l.variantId} className="flex justify-between gap-2">
              <span className="truncate">{l.quantity} × {l.name}</span>
            </li>
          ))}
        </ul>
        <TotalsBox totals={view.totals} />
      </aside>
    </div>
  );
}

function MockPayment({ orderId, token, onDone }: { orderId: string; token?: string; onDone: (orderId: string) => void }) {
  const [card, setCard] = useState("4242 4242 4242 4242");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!luhnValid(card)) {
      setMessage("Card number is invalid");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const order = await api<Order>("/payments/mock/confirm", { method: "POST", token, body: { orderId, cardNumber: card } });
      if (order.status === "PAYMENT_FAILED") setMessage(order.history[order.history.length - 1]?.reason ?? "Payment failed — try another card.");
      else onDone(order.id);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={pay} className="space-y-4 rounded-xl border border-border p-5" aria-label="Test payment">
      <p className="flex items-center gap-2 text-sm font-medium"><Lock className="size-4" aria-hidden="true" /> Test mode payment (no real charge)</p>
      <div>
        <Label htmlFor="card">Card number</Label>
        <Input id="card" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(e.target.value)} className="mt-1" />
        <p className="mt-1 text-xs text-muted-foreground">Use 4242 4242 4242 4242 (success) or 4000 0000 0000 0002 (declined).</p>
      </div>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy} data-testid="pay-now">
        {busy && <Loader2 className="animate-spin" />} Pay now
      </Button>
    </form>
  );
}

import type { Metadata } from "next";
import { Checkout } from "@/components/cart/checkout";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return <Checkout stripePublishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null} />;
}

import type { Metadata } from "next";
import { OrderDetail } from "@/components/cart/order-detail";

export const metadata: Metadata = { title: "Order", robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetail id={id} />;
}

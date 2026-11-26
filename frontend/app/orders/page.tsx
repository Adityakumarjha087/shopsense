import type { Metadata } from "next";
import { OrderList } from "@/components/cart/order-list";

export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

export default function OrdersPage() {
  return <OrderList />;
}

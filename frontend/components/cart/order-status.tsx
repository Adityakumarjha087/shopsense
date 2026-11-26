import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

const VARIANT: Record<OrderStatus, "success" | "warning" | "danger" | "secondary"> = {
  PENDING: "warning",
  PAID: "success",
  PAYMENT_FAILED: "danger",
  SHIPPED: "secondary",
  DELIVERED: "success",
  CANCELLED: "danger",
  REFUNDED: "secondary",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={VARIANT[status]} data-testid="order-status">{STATUS_LABEL[status] ?? status}</Badge>;
}

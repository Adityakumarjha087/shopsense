const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrPrecise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formats integer paise as rupees ("₹3,000"). Shows paise only when non-zero. */
export function formatPrice(paise: number): string {
  if (!Number.isFinite(paise)) return "—";
  return paise % 100 === 0 ? inr.format(paise / 100) : inrPrecise.format(paise / 100);
}

export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function formatPercent(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Awaiting payment",
  PAID: "Paid",
  PAYMENT_FAILED: "Payment failed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

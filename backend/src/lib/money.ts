/** All amounts are integer minor units (paise for INR). */
export const FREE_SHIPPING_THRESHOLD = 99_900; // ₹999
export const SHIPPING_FEE = 4_900; // ₹49
export const GST_RATE = 0.18;

export interface Totals {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
}

/** Prices are GST-inclusive; tax is the included component, reported for the invoice. */
export function computeTotals(subtotal: number): Totals {
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  const tax = Math.round(subtotal - subtotal / (1 + GST_RATE));
  return { subtotal, shipping, tax, total: subtotal + shipping };
}

export function formatInr(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

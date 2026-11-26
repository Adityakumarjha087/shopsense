import type { Totals } from "@/lib/types";
import { formatPrice } from "@/lib/format";

export function TotalsBox({ totals }: { totals: Totals }) {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatPrice(totals.subtotal)}</dd></div>
      <div className="flex justify-between"><dt>Shipping</dt><dd>{totals.shipping ? formatPrice(totals.shipping) : "Free"}</dd></div>
      <div className="flex justify-between text-muted-foreground"><dt>GST included</dt><dd>{formatPrice(totals.tax)}</dd></div>
      <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd data-testid="cart-total">{formatPrice(totals.total)}</dd></div>
    </dl>
  );
}

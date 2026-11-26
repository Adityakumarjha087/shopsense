"use client";

import { useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";

function Form({ orderId }: { orderId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        const { error: err } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${location.origin}/orders/${orderId}` } });
        if (err) setError(err.message ?? "Payment failed");
        setBusy(false);
      }}
    >
      <PaymentElement />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={!stripe || busy}>Pay now</Button>
    </form>
  );
}

/** Stripe Elements payment step; the order is marked paid by the backend webhook, not the browser. */
export function StripePayment({ publishableKey, clientSecret, orderId }: { publishableKey: string; clientSecret: string; orderId: string }) {
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <Form orderId={orderId} />
    </Elements>
  );
}

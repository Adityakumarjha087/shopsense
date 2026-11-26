import Stripe from "stripe";
import { randomToken } from "../../lib/id.js";

export interface PaymentIntentResult {
  id: string;
  clientSecret: string;
}

/** Payment provider abstraction. `mock` mode exercises the same webhook state machine without Stripe keys. */
export interface PaymentGateway {
  readonly mode: "stripe" | "mock";
  createIntent(args: { orderId: string; amount: number; currency: string; customerEmail: string }): Promise<PaymentIntentResult>;
  cancelIntent(intentId: string): Promise<void>;
  /** Verifies the signature and parses a webhook payload (throws on invalid signature). */
  constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event;
  /** Signs a payload the way Stripe does (used by mock mode and tests). */
  signPayload(payload: string): string;
}

export class StripeGateway implements PaymentGateway {
  readonly mode: "stripe" | "mock";
  private readonly stripe: Stripe;

  constructor(
    secretKey: string | undefined,
    private readonly webhookSecret: string,
  ) {
    this.mode = secretKey ? "stripe" : "mock";
    // In mock mode the client is only used for local signature generation/verification (no network).
    this.stripe = new Stripe(secretKey ?? "sk_test_mock_offline", { maxNetworkRetries: 2 });
  }

  async createIntent(args: { orderId: string; amount: number; currency: string; customerEmail: string }): Promise<PaymentIntentResult> {
    if (this.mode === "mock") {
      const id = `pi_mock_${randomToken(12)}`;
      return { id, clientSecret: `${id}_secret_${randomToken(8)}` };
    }
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: args.amount,
        currency: args.currency.toLowerCase(),
        receipt_email: args.customerEmail,
        metadata: { orderId: args.orderId },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: `order-${args.orderId}` },
    );
    return { id: intent.id, clientSecret: intent.client_secret ?? "" };
  }

  async cancelIntent(intentId: string): Promise<void> {
    if (this.mode === "mock") return;
    await this.stripe.paymentIntents.cancel(intentId).catch(() => undefined);
  }

  constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  signPayload(payload: string): string {
    return this.stripe.webhooks.generateTestHeaderString({ payload, secret: this.webhookSecret });
  }
}

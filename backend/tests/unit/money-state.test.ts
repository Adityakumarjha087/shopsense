import { describe, expect, it } from "vitest";
import { computeTotals, formatInr, FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from "../../src/lib/money.js";
import { canTransition, TRANSITIONS } from "../../src/modules/orders/state-machine.js";
import { luhnValid, TEST_CARDS } from "../../src/modules/orders/orders.service.js";
import { bucketOf, sha256 } from "../../src/lib/id.js";

describe("money", () => {
  it("charges shipping below the free-shipping threshold only", () => {
    expect(computeTotals(50_000)).toMatchObject({ shipping: SHIPPING_FEE, total: 50_000 + SHIPPING_FEE });
    expect(computeTotals(FREE_SHIPPING_THRESHOLD).shipping).toBe(0);
    expect(computeTotals(0)).toEqual({ subtotal: 0, shipping: 0, tax: 0, total: 0 });
  });

  it("reports the GST component included in the price", () => {
    expect(computeTotals(118_000).tax).toBe(18_000);
  });

  it("formats INR", () => {
    expect(formatInr(299_900)).toBe("₹2,999");
    expect(formatInr(12_345_650)).toBe("₹1,23,456.5");
  });
});

describe("order state machine", () => {
  it("allows the happy path and blocks invalid jumps", () => {
    expect(canTransition("PENDING", "PAID")).toBe(true);
    expect(canTransition("PAID", "SHIPPED")).toBe(true);
    expect(canTransition("SHIPPED", "DELIVERED")).toBe(true);
    expect(canTransition("PENDING", "DELIVERED")).toBe(false);
    expect(canTransition("CANCELLED", "PAID")).toBe(false);
    expect(TRANSITIONS.REFUNDED).toEqual([]);
  });
});

describe("cards and hashing", () => {
  it("validates Luhn checksums", () => {
    expect(luhnValid(TEST_CARDS.success)).toBe(true);
    expect(luhnValid(TEST_CARDS.declined)).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(luhnValid("123")).toBe(false);
  });

  it("buckets deterministically in [0,100)", () => {
    expect(bucketOf("user-1")).toBe(bucketOf("user-1"));
    for (let i = 0; i < 50; i++) {
      const b = bucketOf(`s${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
    expect(sha256("x")).toHaveLength(64);
  });
});

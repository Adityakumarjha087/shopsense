import { describe, expect, it } from "vitest";
import { assignVariant, DEFAULT_VARIANTS, normalCdf, twoProportionZTest } from "../../src/modules/recommendations/experiments.js";

describe("assignVariant", () => {
  it("is sticky per subject", () => {
    expect(assignVariant(DEFAULT_VARIANTS, "abc").key).toBe(assignVariant(DEFAULT_VARIANTS, "abc").key);
  });

  it("splits traffic roughly by weight", () => {
    const counts = { A: 0, B: 0 } as Record<string, number>;
    for (let i = 0; i < 4000; i++) counts[assignVariant(DEFAULT_VARIANTS, `subject-${i}`).key]! += 1;
    expect(counts.A! / 4000).toBeGreaterThan(0.45);
    expect(counts.A! / 4000).toBeLessThan(0.55);
  });

  it("respects a 100/0 split and zero total weight", () => {
    const allB = [
      { key: "A", strategy: "als" as const, weight: 0 },
      { key: "B", strategy: "item_knn" as const, weight: 100 },
    ];
    for (let i = 0; i < 50; i++) expect(assignVariant(allB, `s${i}`).key).toBe("B");
    expect(assignVariant([{ key: "A", strategy: "als", weight: 0 }], "x").key).toBe("A");
  });
});

describe("statistics", () => {
  it("approximates the normal CDF", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 4);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("detects a significant CTR difference", () => {
    const res = twoProportionZTest(100, 2000, 160, 2000);
    expect(res.significant).toBe(true);
    expect(res.z).toBeGreaterThan(0);
    expect(twoProportionZTest(10, 200, 11, 200).significant).toBe(false);
    expect(twoProportionZTest(0, 0, 1, 10)).toEqual({ z: 0, pValue: 1, significant: false });
    expect(twoProportionZTest(0, 10, 0, 10).pValue).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { summarizeExtractive, summarizeReviews } from "../../src/modules/reviews/summarizer.js";
import { FakeLlmProvider } from "../../src/modules/llm/fake.provider.js";
import type { ChatRequest, LlmProvider } from "../../src/modules/llm/types.js";

const reviews = [
  { rating: 5, title: "Love it", body: "Really comfortable for all-day wear. Great value for money." },
  { rating: 5, title: "Great buy", body: "Super soft and comfy. Worth every rupee." },
  { rating: 4, title: "Very happy", body: "Comfortable right out of the box. Only downside: runs small, order a size up." },
  { rating: 2, title: "Disappointed", body: "Runs small, order a size up. The fit is too tight around the shoulders." },
  { rating: 4, title: "Solid purchase", body: "Excellent quality, feels well made." },
];

describe("summarizeExtractive", () => {
  it("produces 'love X / complain about Y' style summaries", () => {
    const s = summarizeExtractive(reviews);
    expect(s.pros).toContain("comfort");
    expect(s.cons).toContain("fit and sizing");
    expect(s.summary).toMatch(/Customers love the .*comfort/);
    expect(s.summary).toMatch(/Some complain about the fit and sizing/);
    expect(s.summary).toMatch(/4\.0★ across 5 reviews/);
    expect(s.pros.filter((p) => s.cons.includes(p))).toEqual([]);
  });

  it("handles empty and negative sets", () => {
    expect(summarizeExtractive([]).summary).toBe("No reviews yet.");
    const neg = summarizeExtractive([
      { rating: 1, title: "Not great", body: "Broke after light use. Quality feels cheap and flimsy." },
      { rating: 2, title: "Expected better", body: "Stitching tore after a month. Poor finish." },
    ]);
    expect(neg.summary).toMatch(/largely critical/);
    expect(neg.cons.length).toBeGreaterThan(0);
  });

  it("treats negated praise as negative", () => {
    const s = summarizeExtractive([
      { rating: 2, title: "Meh", body: "Not comfortable at all." },
      { rating: 2, title: "Meh", body: "Not comfortable after an hour." },
    ]);
    expect(s.cons).toContain("comfort");
  });
});

describe("summarizeReviews", () => {
  it("uses the extractive path for the fake provider", async () => {
    const s = await summarizeReviews(reviews, new FakeLlmProvider(), "Tee");
    expect(s.provider).toBe("extractive");
  });

  const llm = (content: string | Error): LlmProvider => ({
    name: "openai",
    model: "test-model",
    chat: async (_req: ChatRequest) => {
      if (content instanceof Error) throw content;
      return { content, toolCalls: [], stopReason: "end" };
    },
  });

  it("parses JSON from a real provider", async () => {
    const s = await summarizeReviews(reviews, llm('Sure: {"summary":"Customers love the comfort.","pros":["comfort"],"cons":["sizing", 3]}'), "Tee");
    expect(s).toEqual({ summary: "Customers love the comfort.", pros: ["comfort"], cons: ["sizing"], provider: "openai:test-model" });
  });

  it("falls back to extractive on bad output or errors", async () => {
    expect((await summarizeReviews(reviews, llm("no json here"), "Tee")).provider).toBe("extractive");
    expect((await summarizeReviews(reviews, llm('{"summary": 5}'), "Tee")).provider).toBe("extractive");
    expect((await summarizeReviews(reviews, llm(new Error("boom")), "Tee")).provider).toBe("extractive");
  });
});

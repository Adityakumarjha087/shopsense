import { describe, expect, it } from "vitest";
import { parseQuery } from "../../src/modules/search/query-parser.js";

describe("parseQuery", () => {
  it("extracts a rupee max price and strips it from the text", () => {
    expect(parseQuery("cozy winter outfit under ₹3000")).toEqual({ text: "cozy winter outfit", maxPrice: 300000 });
  });

  it("handles k suffix, commas and 'below'", () => {
    expect(parseQuery("earbuds below 2.5k").maxPrice).toBe(250000);
    expect(parseQuery("coat less than Rs 8,500").maxPrice).toBe(850000);
  });

  it("parses ranges in either order", () => {
    const q = parseQuery("sneakers between 4000 and 1500");
    expect(q.minPrice).toBe(150000);
    expect(q.maxPrice).toBe(400000);
    expect(q.text).toBe("sneakers");
    expect(parseQuery("mugs 500-1000")).toMatchObject({ minPrice: 50000, maxPrice: 100000, text: "mugs" });
  });

  it("parses minimum prices and stock intent", () => {
    expect(parseQuery("watch above 3000 in stock")).toEqual({ text: "watch", minPrice: 300000, inStock: true });
  });

  it("removes conversational filler but never empties the query", () => {
    expect(parseQuery("show me some warm winter jackets").text).toBe("warm winter jackets");
    expect(parseQuery("the best").text).toBe("the best");
  });

  it("leaves plain queries untouched", () => {
    expect(parseQuery("running shoes")).toEqual({ text: "running shoes" });
  });
});

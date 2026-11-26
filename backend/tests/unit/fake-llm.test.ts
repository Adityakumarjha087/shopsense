import { describe, expect, it } from "vitest";
import { detectIntent, FakeLlmProvider, parseOptions, parseShown, resolveRefs } from "../../src/modules/llm/fake.provider.js";
import { buildSystemPrompt } from "../../src/modules/assistant/assistant.service.js";
import { TOOL_DEFINITIONS } from "../../src/modules/assistant/tools.js";
import type { ChatMessage } from "../../src/modules/llm/types.js";

const shown = [
  { id: "p1", slug: "stridewell-tempo-running-shoes", name: "Stridewell Tempo Recycled Mesh Running Shoes", price: 279900 },
  { id: "p2", slug: "trailfinch-marathon", name: "Trailfinch Marathon Engineered Mesh Running Shoes", price: 379900 },
  { id: "p3", slug: "socks", name: "Ridgerun Cushioned Sports Socks", price: 39900 },
];
const system = buildSystemPrompt(shown, true);

describe("fake LLM parsing helpers", () => {
  it("detects intents", () => {
    expect(detectIntent("hello")).toBe("greeting");
    expect(detectIntent("compare the first two")).toBe("compare");
    expect(detectIntent("add it to my cart")).toBe("add");
    expect(detectIntent("is it in stock in M?")).toBe("stock");
    expect(detectIntent("tell me more about the second")).toBe("details");
    expect(detectIntent("cozy winter outfit under 3000")).toBe("search");
  });

  it("parses shown products from the system prompt", () => {
    expect(parseShown(system).map((s) => s.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("parses sizes, colours and quantities", () => {
    expect(parseOptions("add 2 units in size UK 9 black")).toEqual({ size: "UK 9", color: "Black", quantity: 2 });
    expect(parseOptions("the hoodie in size m, navy")).toMatchObject({ size: "M", color: "Navy" });
    expect(parseOptions("add three of them in grey")).toMatchObject({ quantity: 3, color: "Grey" });
  });

  it("resolves ordinal, plural and name references", () => {
    const s = parseShown(system);
    expect(resolveRefs("the second one", s)).toEqual(["p2"]);
    expect(resolveRefs("both", s)).toEqual(["p1", "p2"]);
    expect(resolveRefs("the last one", s)).toEqual(["p3"]);
    expect(resolveRefs("the trailfinch marathon please", s)).toEqual(["p2"]);
    expect(resolveRefs("anything", [])).toEqual([]);
  });
});

describe("FakeLlmProvider protocol", () => {
  const llm = new FakeLlmProvider();
  const ask = (text: string, extra: ChatMessage[] = []) =>
    llm.chat({ system, tools: TOOL_DEFINITIONS, messages: [{ role: "user", content: text }, ...extra] });

  it("greets without tools", async () => {
    const res = await ask("hi");
    expect(res.toolCalls).toEqual([]);
    expect(res.content).toMatch(/ShopSense assistant/);
  });

  it("plans compare/stock/add/details calls against shown products", async () => {
    expect((await ask("compare the first two")).toolCalls[0]).toMatchObject({ name: "compare_products", arguments: { products: ["p1", "p2"] } });
    expect((await ask("is the third one available?")).toolCalls[0]).toMatchObject({ name: "check_stock", arguments: { product: "p3" } });
    expect((await ask("add the first one to my cart in size UK 8")).toolCalls[0]).toMatchObject({ name: "add_to_cart", arguments: { product: "p1", size: "UK 8" } });
    expect((await ask("tell me more about the second")).toolCalls[0]).toMatchObject({ name: "get_product_details", arguments: { product: "p2" } });
  });

  it("runs a two-hop compare-by-name plan", async () => {
    const llm2 = new FakeLlmProvider();
    const first = await llm2.chat({ system: buildSystemPrompt([], false), tools: TOOL_DEFINITIONS, messages: [{ role: "user", content: "compare earbuds and speaker" }] });
    expect(first.toolCalls.map((c) => c.name)).toEqual(["search_products", "search_products"]);
    const results: ChatMessage[] = [
      { role: "assistant", content: "", toolCalls: first.toolCalls },
      { role: "tool", toolCallId: first.toolCalls[0]!.id, name: "search_products", content: JSON.stringify({ products: [{ id: "e1" }] }) },
      { role: "tool", toolCallId: first.toolCalls[1]!.id, name: "search_products", content: JSON.stringify({ products: [{ id: "s1" }] }) },
    ];
    const second = await llm2.chat({ system: buildSystemPrompt([], false), tools: TOOL_DEFINITIONS, messages: [{ role: "user", content: "compare earbuds and speaker" }, ...results] });
    expect(second.toolCalls[0]).toMatchObject({ name: "compare_products", arguments: { products: ["e1", "s1"] } });
  });

  it("searches then adds when no product is referenced", async () => {
    const llm3 = new FakeLlmProvider();
    const sys = buildSystemPrompt([], false);
    const first = await llm3.chat({ system: sys, tools: TOOL_DEFINITIONS, messages: [{ role: "user", content: "add a yoga mat to my cart" }] });
    expect(first.toolCalls[0]!.name).toBe("search_products");
    const second = await llm3.chat({
      system: sys,
      tools: TOOL_DEFINITIONS,
      messages: [
        { role: "user", content: "add a yoga mat to my cart" },
        { role: "assistant", content: "", toolCalls: first.toolCalls },
        { role: "tool", toolCallId: first.toolCalls[0]!.id, name: "search_products", content: JSON.stringify({ products: [{ id: "mat1" }] }) },
      ],
    });
    expect(second.toolCalls[0]).toMatchObject({ name: "add_to_cart", arguments: { product: "mat1" } });
  });

  it("composes final answers from tool results", async () => {
    const compose = async (name: string, data: unknown, text = "q") => {
      const res = await new FakeLlmProvider().chat({
        system,
        tools: TOOL_DEFINITIONS,
        messages: [
          { role: "user", content: text },
          { role: "assistant", content: "", toolCalls: [{ id: "c1", name, arguments: {} }] },
          { role: "tool", toolCallId: "c1", name, content: JSON.stringify(data) },
        ],
      });
      return res.content;
    };
    expect(await compose("search_products", { products: [] })).toMatch(/couldn't find/);
    expect(await compose("search_products", { products: [{ name: "Tee", price: "₹499", rating: 4.5, in_stock: true }] })).toMatch(/1\. Tee — ₹499/);
    expect(await compose("add_to_cart", { added: true, product: "Tee", quantity: 1, size: "M", color: "Black", unit_price: "₹499" })).toMatch(/added 1 × Tee \(M, Black\)/);
    expect(await compose("add_to_cart", { added: false, reason: "Requested option is out of stock" })).toMatch(/couldn't add/);
    expect(await compose("check_stock", { product: "Tee", available: true, variants: [{ size: "M", color: "Black", status: "low_stock" }] })).toMatch(/in stock in: M\/Black.*running low/);
    expect(await compose("check_stock", { product: "Tee", available: false, variants: [] })).toMatch(/out of stock/);
    expect(
      await compose("compare_products", { products: [{ name: "A", price_display: "₹1", rating: 4, reviews: 2, in_stock: true }], cheapest: "A", best_rated: "A" }),
    ).toMatch(/both the most affordable and the best rated/);
    expect(await compose("get_product_details", { name: "Tee", brand: "B", price: "₹1", rating: 4, reviews: 3, description: "Soft. Nice." })).toMatch(/Tee by B costs ₹1/);
    expect(await compose("search_products", { error: "bad" })).toMatch(/ran into a problem/);
  });

  it("returns empty content when called without tools", async () => {
    const res = await llm.chat({ system: "x", messages: [{ role: "user", content: "summarise" }] });
    expect(res).toMatchObject({ content: "", toolCalls: [] });
  });
});

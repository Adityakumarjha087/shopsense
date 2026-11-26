import type { ChatMessage, ChatRequest, ChatResponse, LlmProvider, ToolCall } from "./types.js";

/**
 * Deterministic offline "LLM" that performs real tool calling with rule-based planning.
 * It follows the same protocol as hosted providers (emit tool calls → read tool results →
 * answer), so the orchestrator, tools and UI are exercised end-to-end without API keys.
 */

interface ShownProduct {
  index: number;
  id: string;
  name: string;
}

const SHOWN_RE = /^\[(\d+)\] id=(\S+) slug=\S+ name="([^"]*)"/gm;
const SIZES = ["xxl", "xl", "l", "m", "s", "xs"];
const COLORS = ["black", "white", "navy", "grey", "gray", "red", "blue", "green", "beige", "brown", "pink", "olive", "maroon", "silver", "charcoal", "cream", "teal", "mustard", "lavender", "tan", "rose gold", "midnight", "sand"];
const ORDINALS: Array<[RegExp, number]> = [
  [/\b(first|1st|#1|number one)\b/, 0],
  [/\b(second|2nd|#2)\b/, 1],
  [/\b(third|3rd|#3)\b/, 2],
  [/\b(fourth|4th|#4)\b/, 3],
  [/\b(fifth|5th|#5)\b/, 4],
];

type Intent = "greeting" | "compare" | "add" | "stock" | "details" | "search";

export function detectIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (/^\s*(hi|hello|hey|namaste|good (morning|evening))\b[\s!.?]*$/.test(t)) return "greeting";
  if (/\b(compare|comparison|vs\.?|versus|difference between|which (one )?is better)\b/.test(t)) return "compare";
  if (/\b(add|put)\b[\s\S]*\b(cart|bag|basket)\b/.test(t) || /\bbuy\b/.test(t)) return "add";
  if (/\b(in stock|stock|availab\w*)\b/.test(t)) return "stock";
  if (/\b(tell me more|more about|details?|describe|specs?)\b/.test(t)) return "details";
  return "search";
}

export function parseShown(system: string): ShownProduct[] {
  return [...system.matchAll(SHOWN_RE)].map((m) => ({ index: Number(m[1]), id: m[2]!, name: m[3]! }));
}

export function parseOptions(text: string): { size?: string; color?: string; quantity?: number } {
  const t = ` ${text.toLowerCase()} `;
  const uk = t.match(/\b(?:uk|size)\s*(\d{1,2})\b/)?.[1];
  const sizeWord = t.match(/\bsize\s+([a-z]{1,3})\b/)?.[1];
  const sizeLetter = SIZES.find((s) => new RegExp(`\\b(in )?${s}\\b`).test(t) && /\b(size|in)\b/.test(t));
  const size = uk ? `UK ${uk}` : sizeWord && SIZES.includes(sizeWord) ? sizeWord.toUpperCase() : sizeLetter?.toUpperCase();
  const color = COLORS.find((c) => t.includes(` ${c} `) || t.includes(` ${c},`) || t.includes(` ${c}.`));
  const qty = t.match(/\b(\d{1,2})\s*(x|units?|pieces?|pcs|of)\b/)?.[1] ?? t.match(/\b(two|three|four)\b/)?.[1];
  const words: Record<string, number> = { two: 2, three: 3, four: 4 };
  const quantity = qty ? (words[qty] ?? Number(qty)) : undefined;
  return {
    size,
    color: color ? color.replace(/\b\w/g, (c) => c.toUpperCase()).replace("Gray", "Grey") : undefined,
    quantity: quantity && quantity >= 1 && quantity <= 10 ? quantity : undefined,
  };
}

/** Resolves "the first one", "both", or product names to shown product ids. */
export function resolveRefs(text: string, shown: ShownProduct[]): string[] {
  const t = text.toLowerCase();
  if (!shown.length) return [];
  if (/\b(both|these two|those two|them)\b/.test(t)) return shown.slice(0, 2).map((s) => s.id);
  const out: string[] = [];
  for (const [re, idx] of ORDINALS) if (re.test(t) && shown[idx]) out.push(shown[idx]!.id);
  if (/\b(last one|the last)\b/.test(t)) out.push(shown[shown.length - 1]!.id);
  if (out.length) return [...new Set(out)];
  const tokens = new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  const scored = shown
    .map((s) => ({ s, hits: s.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && tokens.has(w)).length }))
    .filter((x) => x.hits >= 2)
    .sort((a, b) => b.hits - a.hits);
  return scored.map((x) => x.s.id);
}

const stripCommand = (text: string) =>
  text
    .replace(/\b(please|can you|could you|i want to|i'd like to|add|put|buy|to my|to the|into my|in my|cart|bag|basket|one|a|an|me|size\s+\w+|\d+\s*(x|units?|pieces?|pcs))\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

interface ToolResultMsg {
  name: string;
  data: Record<string, unknown>;
}

export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake" as const;
  readonly model = "shopsense-fake-1";
  private counter = 0;

  private call(name: string, args: Record<string, unknown>): ToolCall {
    this.counter += 1;
    return { id: `fake-call-${this.counter}`, name, arguments: args };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const lastUserIdx = req.messages.map((m) => m.role).lastIndexOf("user");
    const userMsg = req.messages[lastUserIdx] as Extract<ChatMessage, { role: "user" }> | undefined;
    const text = userMsg?.content ?? "";
    const turn = req.messages.slice(lastUserIdx + 1);
    const results: ToolResultMsg[] = turn
      .filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool")
      .map((m) => ({ name: m.name, data: safeParse(m.content) }));
    const shown = parseShown(req.system);
    const intent = detectIntent(text);
    const opts = parseOptions(text);
    const hasTools = !!req.tools?.length;

    // Review-summary style prompts (no tools) get a JSON answer.
    if (!hasTools) return { content: "", toolCalls: [], stopReason: "end" };

    if (!results.length) {
      const calls = this.plan(intent, text, shown, opts);
      if (!calls.length) return { content: this.greeting(), toolCalls: [], stopReason: "end" };
      return { content: "", toolCalls: calls, stopReason: "tool_calls" };
    }

    // Second hop of multi-step plans.
    const searches = results.filter((r) => r.name === "search_products");
    const done = new Set(results.map((r) => r.name));
    if (intent === "compare" && !done.has("compare_products")) {
      const ids = searches.map((s) => firstProductId(s.data)).filter((x): x is string => !!x);
      const uniq = [...new Set(ids)];
      if (uniq.length >= 2) return { content: "", toolCalls: [this.call("compare_products", { products: uniq.slice(0, 4) })], stopReason: "tool_calls" };
    }
    if (intent === "add" && !done.has("add_to_cart") && searches.length) {
      const id = firstProductId(searches[0]!.data);
      if (id) return { content: "", toolCalls: [this.call("add_to_cart", { product: id, ...opts })], stopReason: "tool_calls" };
    }
    if (intent === "stock" && !done.has("check_stock") && searches.length) {
      const id = firstProductId(searches[0]!.data);
      if (id) return { content: "", toolCalls: [this.call("check_stock", { product: id, size: opts.size, color: opts.color })], stopReason: "tool_calls" };
    }
    return { content: this.compose(results, text), toolCalls: [], stopReason: "end" };
  }

  private plan(intent: Intent, text: string, shown: ShownProduct[], opts: ReturnType<typeof parseOptions>): ToolCall[] {
    const refs = resolveRefs(text, shown);
    switch (intent) {
      case "greeting":
        return [];
      case "compare": {
        if (refs.length >= 2) return [this.call("compare_products", { products: refs.slice(0, 4) })];
        const after = text.replace(/^[\s\S]*?\b(compare|between)\b/i, "");
        const parts = after.split(/\s+(?:and|vs\.?|versus|with|or)\s+|,/i).map((p) => p.replace(/[?.!]/g, "").trim()).filter((p) => p.length > 2);
        if (parts.length >= 2) return parts.slice(0, 4).map((p) => this.call("search_products", { query: p, limit: 1 }));
        if (shown.length >= 2) return [this.call("compare_products", { products: shown.slice(0, 2).map((s) => s.id) })];
        return [this.call("search_products", { query: text, limit: 4 })];
      }
      case "add": {
        const target = refs[0] ?? (stripCommand(text).length < 3 || /\b(it|this|that)\b/i.test(text) ? shown[0]?.id : undefined);
        if (target) return [this.call("add_to_cart", { product: target, ...opts })];
        return [this.call("search_products", { query: stripCommand(text) || text, limit: 3 })];
      }
      case "stock": {
        const target = refs[0] ?? shown[0]?.id;
        if (target) return [this.call("check_stock", { product: target, size: opts.size, color: opts.color })];
        return [this.call("search_products", { query: text.replace(/\b(is|are|in stock|stock|available|availability)\b/gi, " ").trim() || text, limit: 3 })];
      }
      case "details": {
        const target = refs[0] ?? shown[0]?.id;
        if (target) return [this.call("get_product_details", { product: target })];
        return [this.call("search_products", { query: text, limit: 3 })];
      }
      default:
        return [this.call("search_products", { query: text, limit: 5 })];
    }
  }

  private greeting(): string {
    return "Hi! I'm the ShopSense assistant. I can search the catalogue (try “cozy winter outfit under ₹3000”), compare products, check stock for a size or colour, and add items to your cart.";
  }

  private compose(results: ToolResultMsg[], userText: string): string {
    const last = results[results.length - 1]!;
    const d = last.data;
    if (typeof d.error === "string") return `Sorry, I ran into a problem: ${d.error}`;
    switch (last.name) {
      case "add_to_cart": {
        if (!d.added) return `I couldn't add that: ${String(d.reason)}.`;
        const opt = [d.size, d.color].filter(Boolean).join(", ");
        return `Done! I've added ${String(d.quantity)} × ${String(d.product)}${opt ? ` (${opt})` : ""} to your cart at ${String(d.unit_price)} each.`;
      }
      case "compare_products": {
        const rows = (d.products as Array<Record<string, unknown>>) ?? [];
        const lines = rows.map((r) => `• ${String(r.name)} — ${String(r.price_display)}, ${String(r.rating)}★ (${String(r.reviews)} reviews)${r.in_stock ? "" : ", out of stock"}`);
        const verdict = d.cheapest === d.best_rated ? `${String(d.cheapest)} is both the most affordable and the best rated.` : `${String(d.cheapest)} is the most affordable, while ${String(d.best_rated)} has the best rating.`;
        return `Here's how they compare:\n${lines.join("\n")}\n${verdict}`;
      }
      case "check_stock": {
        const variants = (d.variants as Array<Record<string, unknown>>) ?? [];
        const inStock = variants.filter((v) => v.status !== "out_of_stock").map((v) => [v.size, v.color].filter(Boolean).join("/") || "standard");
        const low = variants.filter((v) => v.status === "low_stock").length;
        if (!d.available) return `Sorry, ${String(d.product)} is currently out of stock for that option.`;
        return `Good news — ${String(d.product)} is in stock${inStock.length ? ` in: ${inStock.slice(0, 8).join(", ")}` : ""}.${low ? " Some options are running low." : ""}`;
      }
      case "get_product_details": {
        const desc = String(d.description ?? "").split(/(?<=\.)\s/)[0];
        return `${String(d.name)} by ${String(d.brand)} costs ${String(d.price)} and is rated ${String(d.rating)}★ from ${String(d.reviews)} reviews. ${desc}${d.review_summary ? ` ${String(d.review_summary)}` : ""}`;
      }
      default: {
        const products = (d.products as Array<Record<string, unknown>>) ?? [];
        if (!products.length) return `I couldn't find anything matching “${userText}”. Try a broader description or a higher budget.`;
        const lines = products.map((p, i) => `${i + 1}. ${String(p.name)} — ${String(p.price)} · ${String(p.rating)}★${p.in_stock ? "" : " (out of stock)"}`);
        return `Here are ${products.length} options I found:\n${lines.join("\n")}\nWant me to compare any of these, check sizes, or add one to your cart?`;
      }
    }
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function firstProductId(data: Record<string, unknown>): string | undefined {
  const products = data.products as Array<{ id?: string }> | undefined;
  return products?.[0]?.id;
}

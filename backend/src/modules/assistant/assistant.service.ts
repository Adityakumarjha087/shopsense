import type { PrismaClient } from "@prisma/client";
import type { Cache } from "../../lib/cache.js";
import { logger } from "../../lib/logger.js";
import { formatInr } from "../../lib/money.js";
import type { ProductCard } from "../catalog/catalog.service.js";
import type { SearchQueryInput } from "../search/search.routes.js";
import type { ChatMessage, LlmProvider } from "../llm/types.js";
import { LlmError } from "../llm/types.js";
import { AssistantTools, TOOL_DEFINITIONS, type CartAction, type ToolEffects } from "./tools.js";

export const MAX_TOOL_STEPS = 5;

export interface AssistantRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  shownProducts: Array<{ id: string; slug: string; name: string; price: number }>;
  userId?: string;
}

export interface AssistantReply {
  reply: string;
  products: ProductCard[];
  comparison: Array<Record<string, unknown>> | null;
  cartActions: CartAction[];
  toolCalls: Array<{ name: string; arguments: Record<string, unknown>; isError: boolean }>;
  provider: string;
}

export function buildSystemPrompt(shown: AssistantRequest["shownProducts"], signedIn: boolean): string {
  const shownBlock = shown.length
    ? shown.map((p, i) => `[${i + 1}] id=${p.id} slug=${p.slug} name="${p.name.replace(/"/g, "'")}" price=${formatInr(p.price)}`).join("\n")
    : "(none)";
  return [
    "You are ShopSense's shopping assistant for an Indian online store (prices in ₹).",
    "Use the tools to search the catalogue, compare products, check stock and add items to the cart; never invent products, prices or stock.",
    "When the shopper refers to 'the first one', 'both' or a product name, resolve it against the products currently shown below and pass their ids to tools.",
    "Keep answers short (under 120 words) and mention prices and ratings. Ask a brief clarifying question if the request is ambiguous.",
    signedIn ? "The shopper is signed in; add_to_cart updates their saved cart." : "The shopper is a guest; add_to_cart adds to their browser cart.",
    "",
    "Products currently shown to the shopper:",
    shownBlock,
  ].join("\n");
}

export class AssistantService {
  constructor(
    private readonly llm: LlmProvider,
    private readonly prisma: PrismaClient,
    private readonly cache: Cache,
    private readonly search: (q: SearchQueryInput) => Promise<{ items: ProductCard[] }>,
  ) {}

  async chat(req: AssistantRequest): Promise<AssistantReply> {
    const tools = new AssistantTools({ prisma: this.prisma, cache: this.cache, search: this.search, userId: req.userId });
    const effects: ToolEffects = { products: [], cartActions: [] };
    const trace: AssistantReply["toolCalls"] = [];
    const convo: ChatMessage[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
    const system = buildSystemPrompt(req.shownProducts, !!req.userId);

    let reply = "";
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const res = await this.llm.chat({ system, messages: convo, tools: TOOL_DEFINITIONS, maxTokens: 4000 });
      if (res.stopReason === "refusal") {
        reply = "Sorry, I can't help with that request. I can help you find, compare and buy products.";
        break;
      }
      if (!res.toolCalls.length) {
        reply = res.content;
        break;
      }
      convo.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls, raw: res.raw });
      const outputs = await Promise.all(res.toolCalls.map((c) => tools.execute(c.name, c.arguments, effects)));
      res.toolCalls.forEach((c, i) => {
        const out = outputs[i]!;
        trace.push({ name: c.name, arguments: c.arguments, isError: out.isError });
        convo.push({ role: "tool", toolCallId: c.id, name: c.name, content: out.content, isError: out.isError });
      });
    }
    if (!reply) reply = "I've gathered the details above. Let me know if you'd like me to narrow things down.";
    logger.info({ provider: this.llm.name, tools: trace.map((t) => t.name) }, "assistant turn");

    const seen = new Set<string>();
    const products = effects.products.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))).slice(0, 8);
    return { reply, products, comparison: effects.comparison ?? null, cartActions: effects.cartActions, toolCalls: trace, provider: `${this.llm.name}:${this.llm.model}` };
  }
}

export { LlmError };

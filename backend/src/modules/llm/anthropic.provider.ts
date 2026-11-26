import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlock,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ChatMessage, ChatRequest, ChatResponse, LlmProvider } from "./types.js";
import { LlmError } from "./types.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export function toAnthropicMessages(messages: ChatMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  let pendingResults: BetaToolResultBlockParam[] = [];
  const flush = () => {
    if (pendingResults.length) {
      // All tool results for one assistant turn go back in a single user message.
      out.push({ role: "user", content: pendingResults });
      pendingResults = [];
    }
  };
  for (const m of messages) {
    if (m.role === "tool") {
      pendingResults.push({ type: "tool_result", tool_use_id: m.toolCallId, content: m.content, is_error: m.isError });
      continue;
    }
    flush();
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.raw) {
      // Replay provider-native blocks unchanged (thinking blocks must round-trip verbatim).
      out.push({ role: "assistant", content: m.raw as BetaContentBlockParam[] });
    } else {
      const blocks: BetaContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.arguments });
      out.push({ role: "assistant", content: blocks.length ? blocks : m.content });
    }
  }
  flush();
  return out;
}

/**
 * Claude via the official SDK. Uses adaptive thinking (the model default), low effort for a
 * chat-latency workload, and server-side refusal fallbacks so a declined turn is retried on
 * a fallback model inside the same call.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string | undefined,
    readonly model: string = DEFAULT_ANTHROPIC_MODEL,
    fetchImpl?: typeof fetch,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    let response: BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: toAnthropicMessages(req.messages),
        ...(req.tools?.length
          ? {
              tools: req.tools.map(
                (t): BetaTool => ({ name: t.name, description: t.description, input_schema: t.parameters as BetaTool["input_schema"] }),
              ),
            }
          : {}),
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new LlmError("Anthropic rate limit", this.name, true);
      if (err instanceof Anthropic.APIConnectionError) throw new LlmError("Anthropic unreachable", this.name, true);
      if (err instanceof Anthropic.APIError) throw new LlmError(`Anthropic API error ${err.status}`, this.name, (err.status ?? 0) >= 500);
      throw err;
    }
    const stop = response.stop_reason;
    if (stop === "refusal") return { content: "", toolCalls: [], raw: response.content, stopReason: "refusal" };
    const text = response.content
      .filter((b): b is BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolCalls = response.content
      .filter((b): b is BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, arguments: (b.input ?? {}) as Record<string, unknown> }));
    return {
      content: text,
      toolCalls,
      raw: response.content,
      stopReason: stop === "tool_use" ? "tool_calls" : stop === "end_turn" ? "end" : stop === "max_tokens" ? "max_tokens" : "other",
    };
  }
}

import OpenAI from "openai";
import type { ChatMessage, ChatRequest, ChatResponse, LlmProvider } from "./types.js";
import { LlmError } from "./types.js";

type OAMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export function toOpenAiMessages(system: string, messages: ChatMessage[]): OAMessage[] {
  const out: OAMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    else
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: JSON.stringify(c.arguments) },
              })),
            }
          : {}),
      });
  }
  return out;
}

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai" as const;
  private readonly client: OpenAI;

  constructor(
    apiKey: string | undefined,
    readonly model: string = "gpt-4o-mini",
    fetchImpl?: typeof fetch,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, timeout: 60_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: req.maxTokens ?? 2048,
        messages: toOpenAiMessages(req.system, req.messages),
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
      });
      const choice = res.choices[0];
      const toolCalls = (choice?.message.tool_calls ?? [])
        .filter((c) => c.type === "function")
        .map((c) => ({ id: c.id, name: c.function.name, arguments: safeJson(c.function.arguments) }));
      return {
        content: choice?.message.content ?? "",
        toolCalls,
        stopReason: choice?.finish_reason === "tool_calls" ? "tool_calls" : choice?.finish_reason === "length" ? "max_tokens" : "end",
      };
    } catch (err) {
      if (err instanceof OpenAI.APIError) throw new LlmError(`OpenAI API error ${err.status ?? ""}`, this.name, (err.status ?? 500) >= 429);
      throw err;
    }
  }
}

export function safeJson(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

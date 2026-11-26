import type { ChatMessage, ChatRequest, ChatResponse, LlmProvider } from "./types.js";
import { LlmError } from "./types.js";

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  tool_name?: string;
}

export function toOllamaMessages(system: string, messages: ChatMessage[]): OllamaMessage[] {
  return [
    { role: "system", content: system },
    ...messages.map((m): OllamaMessage => {
      if (m.role === "user") return { role: "user", content: m.content };
      if (m.role === "tool") return { role: "tool", content: m.content, tool_name: m.name };
      return {
        role: "assistant",
        content: m.content,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) } : {}),
      };
    }),
  ];
}

/** Local models through Ollama's /api/chat (tool calling supported by e.g. llama3.1, qwen2.5). */
export class OllamaProvider implements LlmProvider {
  readonly name = "ollama" as const;

  constructor(
    private readonly baseUrl: string,
    readonly model: string = "llama3.1",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: toOllamaMessages(req.system, req.messages),
          ...(req.tools?.length
            ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
            : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new LlmError(`Ollama unreachable: ${(err as Error).message}`, this.name, true);
    }
    if (!res.ok) throw new LlmError(`Ollama error ${res.status}`, this.name, res.status >= 500);
    const data = (await res.json()) as { message?: OllamaMessage; done_reason?: string };
    const toolCalls = (data.message?.tool_calls ?? []).map((c, i) => ({
      id: `ollama-call-${i}`,
      name: c.function.name,
      arguments: c.function.arguments ?? {},
    }));
    return {
      content: data.message?.content ?? "",
      toolCalls,
      stopReason: toolCalls.length ? "tool_calls" : data.done_reason === "length" ? "max_tokens" : "end",
    };
  }
}

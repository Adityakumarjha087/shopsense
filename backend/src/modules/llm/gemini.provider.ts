import type { ChatMessage, ChatRequest, ChatResponse, LlmProvider } from "./types.js";
import { LlmError } from "./types.js";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", parts: [{ text: m.content }] });
    else if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.arguments } });
      out.push({ role: "model", parts });
    } else {
      const part: GeminiPart = { functionResponse: { name: m.name, response: { content: m.content } } };
      const last = out[out.length - 1];
      if (last && last.role === "user" && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else out.push({ role: "user", parts: [part] });
    }
  }
  return out;
}

/** Google Gemini via the public REST API (generateContent with function declarations). */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;

  constructor(
    private readonly apiKey: string | undefined,
    readonly model: string = "gemini-2.5-flash",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.apiKey) throw new LlmError("GEMINI_API_KEY is not set", this.name);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: toGeminiContents(req.messages),
        generationConfig: { maxOutputTokens: req.maxTokens ?? 2048 },
        ...(req.tools?.length
          ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] }
          : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new LlmError(`Gemini API error ${res.status}`, this.name, res.status >= 429);
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }> };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({ id: `gemini-call-${i}`, name: p.functionCall!.name, arguments: p.functionCall!.args ?? {} }));
    return {
      content: parts.map((p) => p.text ?? "").join(""),
      toolCalls,
      stopReason: toolCalls.length ? "tool_calls" : data.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "max_tokens" : "end",
    };
  }
}

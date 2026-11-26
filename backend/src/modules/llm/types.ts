/** Provider-neutral chat + tool-calling interface. */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (object) describing the tool input. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ToolCall[];
      /** Provider-native content to replay verbatim (e.g. Anthropic thinking blocks). */
      raw?: unknown;
    }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  raw?: unknown;
  stopReason: "end" | "tool_calls" | "max_tokens" | "refusal" | "other";
}

export interface LlmProvider {
  readonly name: "fake" | "openai" | "anthropic" | "gemini" | "ollama";
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

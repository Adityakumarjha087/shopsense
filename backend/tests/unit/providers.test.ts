import { describe, expect, it } from "vitest";
import { AnthropicProvider, toAnthropicMessages } from "../../src/modules/llm/anthropic.provider.js";
import { OpenAiProvider, safeJson, toOpenAiMessages } from "../../src/modules/llm/openai.provider.js";
import { GeminiProvider, toGeminiContents } from "../../src/modules/llm/gemini.provider.js";
import { OllamaProvider, toOllamaMessages } from "../../src/modules/llm/ollama.provider.js";
import { createLlmProvider } from "../../src/modules/llm/factory.js";
import { LlmError, type ChatMessage } from "../../src/modules/llm/types.js";
import { env } from "../../src/config/env.js";

const tools = [{ name: "search_products", description: "search", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }];

const convo: ChatMessage[] = [
  { role: "user", content: "find shoes" },
  { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "search_products", arguments: { query: "shoes" } }, { id: "t2", name: "search_products", arguments: { query: "socks" } }] },
  { role: "tool", toolCallId: "t1", name: "search_products", content: "{}" },
  { role: "tool", toolCallId: "t2", name: "search_products", content: "{}", isError: true },
];

function mockFetch(handler: (url: string, body: Record<string, unknown>, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, body, headers: new Headers(init?.headers) });
    const out = handler(url, body, init ?? {});
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

describe("message conversion", () => {
  it("groups all tool results into one Anthropic user turn", () => {
    const msgs = toAnthropicMessages(convo);
    expect(msgs).toHaveLength(3);
    expect(msgs[2]).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1" }, { type: "tool_result", tool_use_id: "t2", is_error: true }] });
    expect(msgs[1]!.content).toEqual([
      { type: "tool_use", id: "t1", name: "search_products", input: { query: "shoes" } },
      { type: "tool_use", id: "t2", name: "search_products", input: { query: "socks" } },
    ]);
  });

  it("replays raw Anthropic content verbatim", () => {
    const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "x", name: "n", input: {} }];
    expect(toAnthropicMessages([{ role: "user", content: "a" }, { role: "assistant", content: "", raw }])[1]!.content).toBe(raw);
  });

  it("maps to OpenAI, Gemini and Ollama formats", () => {
    const oa = toOpenAiMessages("sys", convo);
    expect(oa[0]).toEqual({ role: "system", content: "sys" });
    expect(oa[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "t1", function: { name: "search_products", arguments: '{"query":"shoes"}' } }, { id: "t2" }] });
    expect(oa[3]).toEqual({ role: "tool", tool_call_id: "t1", content: "{}" });

    const g = toGeminiContents(convo);
    expect(g).toHaveLength(3);
    expect(g[2]!.parts).toHaveLength(2);
    expect(g[1]!.parts[0]).toEqual({ functionCall: { name: "search_products", args: { query: "shoes" } } });

    const ol = toOllamaMessages("sys", convo);
    expect(ol[2]).toMatchObject({ role: "assistant", tool_calls: [{ function: { name: "search_products" } }, { function: { name: "search_products" } }] });
    expect(ol[3]).toMatchObject({ role: "tool", tool_name: "search_products" });
  });

  it("safeJson tolerates garbage", () => {
    expect(safeJson("{")).toEqual({});
    expect(safeJson("[1]")).toEqual({});
    expect(safeJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("AnthropicProvider", () => {
  it("sends adaptive-thinking-compatible requests with fallbacks and parses tool calls", async () => {
    const { fn, calls } = mockFetch(() => ({
      body: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [
          { type: "text", text: "Searching." },
          { type: "tool_use", id: "toolu_1", name: "search_products", input: { query: "shoes" } },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }));
    const p = new AnthropicProvider("sk-ant-test", undefined, fn);
    expect(p.model).toBe("claude-opus-5-5");
    const res = await p.chat({ system: "s", messages: [{ role: "user", content: "hi" }], tools });
    expect(res.stopReason).toBe("tool_calls");
    expect(res.content).toBe("Searching.");
    expect(res.toolCalls).toEqual([{ id: "toolu_1", name: "search_products", arguments: { query: "shoes" } }]);
    const req = calls[0]!;
    expect(req.url).toMatch(/\/v1\/messages/);
    expect(req.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low" } });
    expect(req.body.thinking).toBeUndefined();
    expect(req.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect((req.body.tools as Array<{ input_schema: unknown }>)[0]!.input_schema).toEqual(tools[0]!.parameters);
  });

  it("maps refusals and API errors", async () => {
    const refusal = mockFetch(() => ({
      body: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: "refusal", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } },
    }));
    expect((await new AnthropicProvider("k", undefined, refusal.fn).chat({ system: "s", messages: [{ role: "user", content: "x" }] })).stopReason).toBe("refusal");

    const bad = mockFetch(() => ({ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "bad" } } }));
    await expect(new AnthropicProvider("k", undefined, bad.fn).chat({ system: "s", messages: [{ role: "user", content: "x" }] })).rejects.toBeInstanceOf(LlmError);
  });
});

describe("OpenAiProvider", () => {
  it("parses function tool calls", async () => {
    const { fn, calls } = mockFetch(() => ({
      body: {
        id: "c",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o-mini",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "search_products", arguments: '{"query":"mugs"}' } }] },
          },
        ],
      },
    }));
    const res = await new OpenAiProvider("sk-test", "gpt-4o-mini", fn).chat({ system: "s", messages: [{ role: "user", content: "mugs" }], tools });
    expect(res).toMatchObject({ stopReason: "tool_calls", toolCalls: [{ id: "call_1", name: "search_products", arguments: { query: "mugs" } }] });
    expect((calls[0]!.body.tools as unknown[]).length).toBe(1);
  });

  it("wraps API errors", async () => {
    const { fn } = mockFetch(() => ({ status: 401, body: { error: { message: "nope" } } }));
    await expect(new OpenAiProvider("sk", "m", fn).chat({ system: "s", messages: [{ role: "user", content: "x" }] })).rejects.toBeInstanceOf(LlmError);
  });
});

describe("GeminiProvider", () => {
  it("calls generateContent with function declarations", async () => {
    const { fn, calls } = mockFetch(() => ({
      body: { candidates: [{ content: { parts: [{ text: "ok " }, { functionCall: { name: "search_products", args: { query: "x" } } }] }, finishReason: "STOP" }] },
    }));
    const res = await new GeminiProvider("g-key", "gemini-2.5-flash", fn).chat({ system: "s", messages: [{ role: "user", content: "x" }], tools });
    expect(res.toolCalls[0]).toMatchObject({ name: "search_products", arguments: { query: "x" } });
    expect(calls[0]!.url).toContain("gemini-2.5-flash:generateContent");
    expect(calls[0]!.headers.get("x-goog-api-key")).toBe("g-key");
  });

  it("errors without a key or on HTTP failure", async () => {
    await expect(new GeminiProvider(undefined).chat({ system: "s", messages: [] })).rejects.toBeInstanceOf(LlmError);
    const { fn } = mockFetch(() => ({ status: 500, body: {} }));
    await expect(new GeminiProvider("k", "m", fn).chat({ system: "s", messages: [] })).rejects.toBeInstanceOf(LlmError);
  });
});

describe("OllamaProvider", () => {
  it("posts to /api/chat and parses tool calls", async () => {
    const { fn, calls } = mockFetch(() => ({ body: { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "check_stock", arguments: { product: "p" } } }] }, done_reason: "stop" } }));
    const res = await new OllamaProvider("http://ollama:11434/", "llama3.1", fn).chat({ system: "s", messages: [{ role: "user", content: "x" }], tools });
    expect(calls[0]!.url).toBe("http://ollama:11434/api/chat");
    expect(res.toolCalls[0]).toMatchObject({ name: "check_stock", arguments: { product: "p" } });
  });

  it("maps connection failures", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(new OllamaProvider("http://x", "m", failing).chat({ system: "s", messages: [] })).rejects.toBeInstanceOf(LlmError);
  });
});

describe("createLlmProvider", () => {
  it("selects providers by env and falls back to fake without keys", () => {
    expect(createLlmProvider({ ...env, LLM_PROVIDER: "fake" }).name).toBe("fake");
    expect(createLlmProvider({ ...env, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: undefined }).name).toBe("fake");
    expect(createLlmProvider({ ...env, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }).model).toBe("claude-opus-5-5");
    expect(createLlmProvider({ ...env, LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" }).name).toBe("openai");
    expect(createLlmProvider({ ...env, LLM_PROVIDER: "openai", OPENAI_API_KEY: undefined }).name).toBe("fake");
    expect(createLlmProvider({ ...env, LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" }).name).toBe("gemini");
    expect(createLlmProvider({ ...env, LLM_PROVIDER: "gemini", GEMINI_API_KEY: undefined }).name).toBe("fake");
    expect(createLlmProvider({ ...env, LLM_PROVIDER: "ollama", LLM_MODEL: "qwen2.5" }).model).toBe("qwen2.5");
  });
});

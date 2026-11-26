import type { Env } from "../../config/env.js";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.provider.js";
import { FakeLlmProvider } from "./fake.provider.js";
import { GeminiProvider } from "./gemini.provider.js";
import { OllamaProvider } from "./ollama.provider.js";
import { OpenAiProvider } from "./openai.provider.js";
import type { LlmProvider } from "./types.js";

/** Selects the LLM provider from LLM_PROVIDER; falls back to the offline fake when keys are missing. */
export function createLlmProvider(env: Env, fetchImpl?: typeof fetch): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) return new FakeLlmProvider();
      return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.LLM_MODEL ?? DEFAULT_ANTHROPIC_MODEL, fetchImpl);
    case "openai":
      if (!env.OPENAI_API_KEY) return new FakeLlmProvider();
      return new OpenAiProvider(env.OPENAI_API_KEY, env.LLM_MODEL ?? "gpt-4o-mini", fetchImpl);
    case "gemini":
      if (!env.GEMINI_API_KEY) return new FakeLlmProvider();
      return new GeminiProvider(env.GEMINI_API_KEY, env.LLM_MODEL ?? "gemini-2.5-flash", fetchImpl);
    case "ollama":
      return new OllamaProvider(env.OLLAMA_BASE_URL, env.LLM_MODEL ?? "llama3.1", fetchImpl);
    default:
      return new FakeLlmProvider();
  }
}

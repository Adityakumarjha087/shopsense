import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().optional(),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:20600"),

  JWT_ACCESS_SECRET: z.string().min(16).default("dev-access-secret-change-me-please"),
  JWT_REFRESH_SECRET: z.string().min(16).default("dev-refresh-secret-change-me-please"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
  /** Shared secret for server-to-server calls from the Next.js (NextAuth) server. */
  INTERNAL_API_KEY: z.string().min(16).default("dev-internal-api-key-change-me"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_ASSISTANT_MAX: z.coerce.number().int().positive().default(30),

  ML_SERVICE_URL: z.string().default("http://localhost:20602"),
  ML_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),

  MEILI_HOST: z.string().optional(),
  MEILI_MASTER_KEY: z.string().optional(),
  MEILI_INDEX: z.string().default("products"),

  LLM_PROVIDER: z.enum(["fake", "openai", "anthropic", "gemini", "ollama"]).default("fake"),
  LLM_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().default("shopsense-mock-webhook-secret"),

  FRONTEND_URL: z.string().default("http://localhost:20600"),
  FRONTEND_REVALIDATE_SECRET: z.string().optional(),

  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  SEARCH_SYNC_ON_START: bool.default(true),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "INTERNAL_API_KEY"] as const) {
      if (env[key].startsWith("dev-")) {
        throw new Error(`${key} must be set to a non-default value in production`);
      }
    }
  }
  return env;
}

export const env: Env = load();

export const paymentMode = (): "stripe" | "mock" => (env.STRIPE_SECRET_KEY ? "stripe" : "mock");

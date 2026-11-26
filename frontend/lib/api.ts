import { PUBLIC_API_URL } from "./config";
import { getSessionId } from "./session-id";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

/** Browser-side API client: adds the anonymous session id and bearer token, normalises errors. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "x-session-id": getSessionId() };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`${PUBLIC_API_URL}/api/v1${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  }
  return data as T;
}

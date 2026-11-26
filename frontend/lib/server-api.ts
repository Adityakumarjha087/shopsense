import "server-only";
import { serverApiUrl } from "./config";

interface ServerFetchOptions {
  revalidate?: number | false;
  tags?: string[];
}

/**
 * Server-side fetch against the backend with Next data-cache options. Returns null on any
 * failure so pages render empty states (e.g. during `next build` without a backend).
 */
export async function serverFetch<T>(path: string, opts: ServerFetchOptions = {}): Promise<T | null> {
  try {
    const res = await fetch(`${serverApiUrl()}/api/v1${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: opts.revalidate ?? 60, tags: opts.tags },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

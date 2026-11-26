export type SearchParams = Record<string, string | string[] | undefined>;

export const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Builds a query string from params, dropping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Rupee input (string) → paise, or undefined. */
export function rupeeParam(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}

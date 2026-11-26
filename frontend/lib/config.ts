/** Browser-visible backend origin. */
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:20601";

/** Backend origin used by server components / route handlers (docker network name in compose). */
export const serverApiUrl = () => process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:20601";

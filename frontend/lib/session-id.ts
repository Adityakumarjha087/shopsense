const KEY = "ss_sid";

/** Stable anonymous id used by the backend for event tracking and A/B assignment. */
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
      localStorage.setItem(KEY, id);
    }
    document.cookie = `${KEY}=${id}; path=/; max-age=31536000; samesite=lax`;
    return id;
  } catch {
    return "anonymous-session";
  }
}

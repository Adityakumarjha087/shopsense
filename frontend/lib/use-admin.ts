"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api, ApiError, type ApiOptions } from "./api";

/** Authenticated fetch helpers for admin screens. */
export function useAdminApi() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const call = useCallback(<T,>(path: string, opts: Omit<ApiOptions, "token"> = {}) => api<T>(path, { ...opts, token }), [token]);
  return { token, call };
}

export function useAdminQuery<T>(path: string | null) {
  const { token, call } = useAdminApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!token || !path) return;
    let cancelled = false;
    setError(null);
    call<T>(path)
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => !cancelled && setError(err instanceof ApiError ? err.message : "Request failed"));
    return () => {
      cancelled = true;
    };
  }, [token, path, call, nonce]);
  return { data, error, reload: () => setNonce((n) => n + 1), setData };
}

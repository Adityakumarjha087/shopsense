"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api";

/** Sends a VIEW interaction once per mount (feeds the recommender). */
export function ViewTracker({ productId }: { productId: string }) {
  const { data: session, status } = useSession();
  const token = session?.accessToken;
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (status === "loading" || sent.current === productId) return;
    sent.current = productId;
    void api("/events", { method: "POST", token, body: { events: [{ type: "VIEW", productId }] } }).catch(() => undefined);
  }, [productId, status, token]);
  return null;
}

"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MessageCircle } from "lucide-react";

// The chat widget is only downloaded once the shopper opens it (keeps first-load JS small).
const ChatWidget = dynamic(() => import("./chat-widget").then((m) => m.ChatWidget), { ssr: false });

export function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {loaded && <ChatWidget open={open} onClose={() => setOpen(false)} />}
      {!open && (
        <button
          type="button"
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
          aria-label="Open shopping assistant"
        >
          <MessageCircle className="size-5" aria-hidden="true" />
          <span className="hidden sm:inline">Ask ShopSense AI</span>
        </button>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function Gallery({ images, name }: { images: Array<{ url: string; alt: string }>; name: string }) {
  const [active, setActive] = useState(0);
  const main = images[active];
  return (
    <div className="space-y-3">
      <div className="aspect-square overflow-hidden rounded-2xl bg-muted">
        {main && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={main.url} alt={main.alt || name} width={640} height={640} fetchPriority="high" className="h-full w-full object-cover" />
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2" role="tablist" aria-label="Product images">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Show image ${i + 1}`}
              onClick={() => setActive(i)}
              className={cn("size-16 overflow-hidden rounded-lg border-2", i === active ? "border-primary" : "border-transparent")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" width={64} height={64} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

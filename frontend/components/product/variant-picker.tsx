"use client";

import type { Variant } from "@/lib/types";
import { cn } from "@/lib/utils";

export const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))];

export function findVariant(variants: Variant[], size: string | null, color: string | null): Variant | undefined {
  return variants.find((v) => (v.size ?? null) === size && (v.color ?? null) === color);
}

/** Size/colour selectors; options whose variant is out of stock are disabled. */
export function VariantPicker({
  variants,
  size,
  color,
  onChange,
}: {
  variants: Variant[];
  size: string | null;
  color: string | null;
  onChange: (next: { size: string | null; color: string | null }) => void;
}) {
  const colors = uniq(variants.map((v) => v.color));
  const sizes = uniq(variants.map((v) => v.size));
  const chip = (selected: boolean, disabled: boolean) =>
    cn(
      "min-w-12 rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      selected ? "border-primary bg-primary/10 font-medium" : "border-border hover:border-foreground/40",
      disabled && "cursor-not-allowed text-muted-foreground line-through opacity-50 hover:border-border",
    );
  return (
    <div className="space-y-4">
      {colors.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            Colour: <span className="font-normal text-muted-foreground">{color ?? "Select"}</span>
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {colors.map((c) => {
              const available = variants.some((v) => v.color === c && v.inStock);
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  disabled={!available}
                  className={chip(color === c, !available)}
                  onClick={() => {
                    // Keep the size if it exists in the new colour, otherwise pick the first in-stock size.
                    const keep = sizes.length && findVariant(variants, size, c)?.inStock ? size : (variants.find((v) => v.color === c && v.inStock)?.size ?? null);
                    onChange({ color: c, size: keep });
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {sizes.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            Size: <span className="font-normal text-muted-foreground">{size ?? "Select"}</span>
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size">
            {sizes.map((s) => {
              const v = findVariant(variants, s, colors.length ? color : null);
              const available = !!v?.inStock;
              return (
                <button key={s} type="button" role="radio" aria-checked={size === s} disabled={!available} className={chip(size === s, !available)} onClick={() => onChange({ size: s, color })}>
                  {s}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}

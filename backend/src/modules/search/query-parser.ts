export interface ParsedQuery {
  /** Free text with price/stock constraints stripped out. */
  text: string;
  minPrice?: number; // paise
  maxPrice?: number; // paise
  inStock?: boolean;
}

const NUM = String.raw`(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?`;
const toPaise = (num: string, k?: string): number => Math.round(parseFloat(num.replace(/,/g, "")) * (k ? 1000 : 1) * 100);

const PATTERNS: Array<{ re: RegExp; apply: (m: RegExpMatchArray, q: ParsedQuery) => void }> = [
  {
    re: new RegExp(String.raw`\bbetween\s+${NUM}\s+(?:and|-|to)\s+${NUM}`, "i"),
    apply: (m, q) => {
      q.minPrice = toPaise(m[1]!, m[2]);
      q.maxPrice = toPaise(m[3]!, m[4]);
    },
  },
  {
    re: new RegExp(String.raw`${NUM}\s*(?:-|to)\s*${NUM}`, "i"),
    apply: (m, q) => {
      q.minPrice = toPaise(m[1]!, m[2]);
      q.maxPrice = toPaise(m[3]!, m[4]);
    },
  },
  {
    re: new RegExp(String.raw`\b(?:under|below|less than|cheaper than|within|upto|up to|max|<=?)\s*${NUM}`, "i"),
    apply: (m, q) => {
      q.maxPrice = toPaise(m[1]!, m[2]);
    },
  },
  {
    re: new RegExp(String.raw`\b(?:over|above|more than|at least|min|>=?)\s*${NUM}`, "i"),
    apply: (m, q) => {
      q.minPrice = toPaise(m[1]!, m[2]);
    },
  },
];

const FILLER =
  /\b(show me|show|find me|find|search for|search|look(?:ing)? for|i(?:'m| am)? (?:want|need|looking for)|i want|i need|can you|could you|please|suggest(?: me)?|recommend(?: me)?|some|any|options?|a few|me|for me|good|best|nice|the|an?|of|that are|which are|what are)\b/gi;

/** Extracts structured constraints from natural-language queries ("cozy winter outfit under ₹3000"). */
export function parseQuery(raw: string): ParsedQuery {
  let text = raw.trim();
  const parsed: ParsedQuery = { text };
  for (const { re, apply } of PATTERNS) {
    const m = text.match(re);
    if (m) {
      apply(m, parsed);
      text = text.replace(m[0], " ");
    }
  }
  if (/\b(in stock|available now|available)\b/i.test(text)) {
    parsed.inStock = true;
    text = text.replace(/\b(in stock|available now|available)\b/gi, " ");
  }
  if (parsed.minPrice !== undefined && parsed.maxPrice !== undefined && parsed.minPrice > parsed.maxPrice) {
    [parsed.minPrice, parsed.maxPrice] = [parsed.maxPrice, parsed.minPrice];
  }
  const cleaned = text.replace(FILLER, " ").replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").replace(/\b(for|with|and)\s*$/i, "").trim();
  // Never strip a query down to nothing (e.g. a search for "the best").
  parsed.text = cleaned || text.replace(/\s+/g, " ").trim();
  return parsed;
}

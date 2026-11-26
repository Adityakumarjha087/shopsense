import { logger } from "../../lib/logger.js";
import type { LlmProvider } from "../llm/types.js";

export interface ReviewInput {
  rating: number;
  title: string;
  body: string;
}

export interface ReviewSummaryResult {
  summary: string;
  pros: string[];
  cons: string[];
  provider: string;
}

interface Aspect {
  key: string;
  label: string;
  terms: RegExp;
}

const ASPECTS: Aspect[] = [
  { key: "comfort", label: "comfort", terms: /\b(comfort\w*|comfy|soft|cozy|cosy|cushion\w*)\b/i },
  { key: "quality", label: "build quality", terms: /\b(quality|well[- ]made|sturdy|stitch\w*|flimsy|cheap(?:ly)?[- ]made|finish)\b/i },
  { key: "fit", label: "fit and sizing", terms: /\b(fit|fits|sizing|size|runs (?:small|large)|tight|loose|snug)\b/i },
  { key: "value", label: "value for money", terms: /\b(value|price|worth|overpriced|expensive|affordable|money)\b/i },
  { key: "battery", label: "battery life", terms: /\b(battery|charge|charging)\b/i },
  { key: "sound", label: "sound quality", terms: /\b(sound|bass|audio|noise|mic)\b/i },
  { key: "performance", label: "performance", terms: /\b(fast|slow|performance|lag\w*|speed|powerful|heats? up)\b/i },
  { key: "durability", label: "durability", terms: /\b(durab\w*|broke|broken|tore|torn|lasted|wear(?:s|ing)? out|fad(?:ed|es))\b/i },
  { key: "design", label: "design", terms: /\b(design|look\w*|colou?r|style|stylish|beautiful|elegant)\b/i },
  { key: "ease", label: "ease of use", terms: /\b(easy|setup|set up|intuitive|instructions|assembl\w*|complicated)\b/i },
  { key: "delivery", label: "delivery and packaging", terms: /\b(deliver\w*|packag\w*|arrived|shipping)\b/i },
  { key: "scent", label: "fragrance", terms: /\b(scent|fragrance|smell\w*)\b/i },
  { key: "warmth", label: "warmth", terms: /\b(warm\w*|insulat\w*|chilly|cold)\b/i },
];

const POSITIVE = /\b(love[sd]?|great|excellent|amazing|perfect|good|nice|happy|impress\w*|superb|fantastic|best|recommend|comfortable|sturdy|beautiful|worth|solid|fast|easy|soft|warm)\b/i;
const NEGATIVE = /\b(bad|poor|terrible|awful|disappoint\w*|broke|broken|cheap|flimsy|small|tight|slow|lag\w*|overpriced|expensive|tore|faded|uncomfortable|hate|worse|worst|complicated|late|damaged|thin|weak|heats? up|runs small|runs large)\b/i;
const NEGATION = /\b(not|never|no|isn't|wasn't|doesn't|don't|hardly)\s+(\w+\s+)?$/i;

function sentencePolarity(sentence: string, rating: number): number {
  let score = 0;
  const words = sentence.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const prefix = words.slice(Math.max(0, i - 2), i).join(" ") + " ";
    const negated = NEGATION.test(prefix);
    if (POSITIVE.test(w)) score += negated ? -1 : 1;
    else if (NEGATIVE.test(w)) score += negated ? 1 : -1;
  }
  if (score === 0) score = rating >= 4 ? 0.5 : rating <= 2 ? -0.5 : 0;
  return score;
}

const joinList = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** Deterministic aspect-based extractive summariser (default "fake" provider and LLM failure fallback). */
export function summarizeExtractive(reviews: ReviewInput[]): ReviewSummaryResult {
  if (!reviews.length) return { summary: "No reviews yet.", pros: [], cons: [], provider: "extractive" };
  const stats = new Map<string, { pos: number; neg: number }>();
  for (const r of reviews) {
    const sentences = `${r.title}. ${r.body}`.split(/(?<=[.!?])\s+|\bbut\b/i).filter((s) => s.trim().length > 2);
    for (const s of sentences) {
      const polarity = sentencePolarity(s, r.rating);
      for (const a of ASPECTS) {
        if (!a.terms.test(s)) continue;
        const st = stats.get(a.key) ?? { pos: 0, neg: 0 };
        if (polarity > 0) st.pos++;
        else if (polarity < 0) st.neg++;
        stats.set(a.key, st);
      }
    }
  }
  const label = (key: string) => ASPECTS.find((a) => a.key === key)!.label;
  const minMentions = Math.max(1, Math.round(reviews.length * 0.1));
  const pros = [...stats.entries()]
    .filter(([, s]) => s.pos >= minMentions && s.pos > s.neg)
    .sort((a, b) => b[1].pos - a[1].pos)
    .slice(0, 3)
    .map(([k]) => label(k));
  const cons = [...stats.entries()]
    .filter(([, s]) => s.neg >= Math.max(1, Math.floor(minMentions / 2)) && s.neg >= s.pos * 0.25)
    .sort((a, b) => b[1].neg - a[1].neg)
    .slice(0, 2)
    .map(([k]) => label(k));
  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  const overall = avg >= 4.2 ? "Customers are very positive" : avg >= 3.5 ? "Customers are mostly positive" : avg >= 2.8 ? "Opinions are mixed" : "Customers are largely critical";
  let summary = `${overall} (${avg.toFixed(1)}★ across ${reviews.length} reviews).`;
  if (pros.length) summary += ` Customers love the ${joinList(pros)}.`;
  if (cons.length) summary += ` Some complain about the ${joinList(cons)}.`;
  return { summary, pros, cons, provider: "extractive" };
}

/** Summarises reviews with the configured LLM, falling back to the extractive summariser. */
export async function summarizeReviews(reviews: ReviewInput[], llm: LlmProvider, productName: string): Promise<ReviewSummaryResult> {
  if (llm.name === "fake" || !reviews.length) return summarizeExtractive(reviews);
  const sample = reviews.slice(0, 40).map((r, i) => `#${i + 1} (${r.rating}/5) ${r.title}: ${r.body}`).join("\n");
  try {
    const res = await llm.chat({
      system:
        "You summarise e-commerce product reviews. Reply with only a JSON object: " +
        '{"summary": string (2 sentences, format "Customers love X ... Some complain about Y ..."), "pros": string[] (max 3 short noun phrases), "cons": string[] (max 2)}. ' +
        "Only use information present in the reviews.",
      messages: [{ role: "user", content: `Product: ${productName}\nReviews:\n${sample}` }],
      maxTokens: 2000,
    });
    const match = res.content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON in LLM response");
    const parsed = JSON.parse(match[0]) as { summary?: unknown; pros?: unknown; cons?: unknown };
    if (typeof parsed.summary !== "string") throw new Error("invalid summary JSON");
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 3) : []);
    return { summary: parsed.summary, pros: strings(parsed.pros), cons: strings(parsed.cons), provider: `${llm.name}:${llm.model}` };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "LLM review summary failed; using extractive");
    return summarizeExtractive(reviews);
  }
}

# Engineering decisions & scope notes

This file records the trade-offs taken while building ShopSense, including where scope was
cut in depth (never in correctness) and why.

## Architecture

| Decision | Why |
|---|---|
| **Express 5 + TypeScript** for the backend (not NestJS) | Small surface, explicit dependency container (`AppContext`) that tests can swap piece by piece. |
| **One `defineRoute` helper** = zod validation + OpenAPI registration | Validation rules and API docs can never drift; Swagger UI at `/api/docs` is generated from the same schemas. |
| **Python ML service owns every learned artefact** (ALS, item-kNN, rules, embeddings) | Keeps numpy/scikit-learn out of Node; backend treats it as optional with tight timeouts and DB fallbacks. |
| **ML reads Postgres directly (read-only SQL)** | Avoids an export API; snake_case `@map` in Prisma makes the tables pleasant to query from Python. |
| **Hybrid search = Meilisearch keyword + ML semantic, fused with weighted RRF in the backend** | Meilisearch gives typo tolerance, filters, facets and autocomplete; semantic candidates are pushed back through Meilisearch (`id IN [...]` + user filters) so facets/price filters apply to both lists. The embedder can be refitted without re-indexing Meilisearch. A greedy category-diversity re-rank keeps broad queries ("cozy winter outfit") from returning a single product type. |
| **Postgres search fallback** (`DbSearchEngine`) | Tests and minimal setups run without Meilisearch; the backend also falls back automatically if Meilisearch is down at boot. |
| **Natural-language constraint parser** | "under ₹3000", "between 1k and 2k", "in stock" are converted to structured filters before retrieval, so the semantic model does not have to understand prices. |
| **Prices as integer paise** | No floating-point money; GST is reported as the component included in the price. |

## Recommendations

- **ALS implemented in numpy** (Hu–Koren–Volinsky confidence weighting) instead of the `implicit`
  package: no native wheels to worry about on linux/arm64 Docker or CI, and the math is visible.
- **A/B test** compares strategy A (ALS) vs B (item-kNN). Assignment is a deterministic hash of
  user id (or anonymous session id); impressions and clicks are logged server-side and the click
  endpoint looks up the variant from the stored impression (clients cannot spoof variants). CTR
  is item-level (clicks / items shown) with a two-proportion z-test.
- **Cold start**: unknown users with session history get item-based fold-in; users with no history
  get recency-decayed popularity; if the ML service is unreachable the backend serves DB popularity.
- **Interaction weights**: view 1, wishlist 2, add-to-cart 3, purchase 5. Purchase events are
  only created server-side when a verified payment webhook moves an order to `PAID`.
- **Nightly retraining** runs in the ML service (APScheduler cron, `TRAIN_CRON`) and is also
  triggerable from the admin dashboard; every run is logged to MLflow.

## Payments

- With no `STRIPE_SECRET_KEY` the gateway runs in **mock mode**: the mock "confirm" endpoint builds a
  Stripe-shaped `payment_intent.*` event, signs it with the webhook secret using Stripe's own
  `generateTestHeaderString`, verifies it with `stripe.webhooks.constructEvent` and runs it through the
  exact handler used by `/api/v1/webhooks/stripe`. The order state machine, idempotency table,
  stock reservation/release and purchase-event emission are therefore identical in both modes.
- Stock is reserved at checkout with a conditional decrement (`stock >= qty`) inside the order
  transaction; payment failure or cancellation releases it.
- Webhook effects and the idempotency record are written in one transaction, so a failed handler
  can be retried by Stripe.

## Auth

- The backend issues its own JWT access tokens (15 min) + **rotating refresh tokens** (hashed at rest,
  token families, reuse detection revokes the family).
- NextAuth on the frontend wraps the backend: the Credentials provider calls `/auth/login`; Google
  (enabled only when credentials are configured) is exchanged server-to-server via `/auth/oauth`
  guarded by `INTERNAL_API_KEY`.
- Anonymous browsing (session id) is adopted into the user's history at login/registration so
  recommendations warm up immediately.

## LLM

- Default provider is a **deterministic offline fake** that performs real tool calling (plans tool
  calls from the user turn, reads tool results, multi-hop plans such as "compare A and B" →
  two searches → compare). It exercises the exact same orchestrator, tool executor and UI as the
  hosted providers.
- Hosted providers: Anthropic (official SDK, default model `claude-opus-5-5`, adaptive thinking
  left at the model default, `effort: low` for chat latency, server-side refusal fallbacks enabled
  via `fallbacks: "default"`; provider-native assistant content is replayed verbatim so thinking
  blocks round-trip), OpenAI (official SDK), Gemini (REST), Ollama (REST). All are tested with
  mocked `fetch`; none were exercised against live APIs because no keys were available.
- Review summaries use the LLM when one is configured (JSON output, validated) and otherwise a
  deterministic aspect-based extractive summariser; summaries are cached per review-set hash.

## Scope cut in depth (documented, not stubbed)

| Spec item | What was built | What was cut |
|---|---|---|
| LightFM / two-tower PyTorch model | ALS + item-kNN + popularity, evaluated side by side | No PyTorch two-tower (keeps CI CPU-light). The strategy interface makes adding one a new `strategy` value. |
| sentence-transformers embeddings | Supported behind `EMBEDDER=sentence-transformers` (optional extra) | Default is an offline LSA embedder (TF-IDF + SVD) so nothing is downloaded at build/test time. |
| Stripe Elements | Wired on the frontend when a publishable key is configured | Never exercised against live Stripe (no keys). The webhook handler is tested with signed fixture events. |
| Google sign-in | NextAuth Google provider + backend exchange endpoint | Not exercised end-to-end (no OAuth credentials). |
| Synthetic data | 570 generated products, 401 users, ~24k interactions, ~1.3k orders | Interactions are simulated from latent preferences, so offline metrics measure the pipeline, not real shoppers. |
| A/B dashboard | Real CTR from logged impressions/clicks | No simulated traffic is seeded: numbers start at zero and grow with real use. |

## Data honesty

All products, brands, reviews and users are generated from templates in
`backend/src/seed/catalog-data.ts`; brand names are invented. No real listings were copied.

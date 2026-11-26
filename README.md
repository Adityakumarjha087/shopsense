# ShopSense — AI-Powered E-Commerce with Recommendations & Shopping Assistant

ShopSense is a full-stack e-commerce store with a personalised recommendation engine, hybrid
keyword + semantic search, and an AI shopping assistant that uses tool calling to search,
compare, check stock and add items to the cart. Everything runs offline by default: a
deterministic tool-calling "fake" LLM and a mock payment mode that drives the same signed
Stripe-webhook state machine as live Stripe.

> All products, brands, reviews and users are **synthetic** (generated from templates in
> `backend/src/seed/`). Brand names are invented.

## Features

- **Catalogue**: 570 seeded products across 10 categories, size/colour variants with per-variant
  inventory, images, reviews and ratings.
- **Cart, wishlist, checkout**: guest cart in the browser (Zustand) merged into the server cart on
  login; atomic stock reservation at checkout (no overselling); order history with a status timeline.
- **Payments**: Stripe test mode (PaymentIntents + Elements + verified webhooks) or **mock mode**
  when no keys are set. Webhooks are idempotent, order-safe and amount-checked.
- **Admin panel**: product CRUD and variant stock, order fulfilment (state machine validated),
  inventory alerts, sales analytics charts, A/B test CTR, ML model metrics and "retrain now".
- **Recommendations** (Python ML service):
  - *Recommended for you*: implicit-feedback ALS (numpy) or item-kNN, chosen by an A/B test.
  - *Similar items*: content embeddings (LSA by default; sentence-transformers optional).
  - *Frequently bought together*: association rules (support / confidence / lift) from baskets.
  - Cold start: session fold-in, then recency-decayed popularity; DB popularity if ML is down.
- **Event tracking → nightly retraining**: view / wishlist / add-to-cart / purchase events feed a
  scheduled training job that logs params and precision@k, recall@k, NDCG@k, hit-rate and
  coverage to **MLflow**.
- **Hybrid search**: Meilisearch (typo tolerance, filters, facets, autocomplete) fused with
  embedding search via weighted Reciprocal Rank Fusion; natural-language constraints such as
  “cozy winter outfit under ₹3000” become structured filters.
- **AI shopping assistant**: tool calling (`search_products`, `get_product_details`,
  `compare_products`, `check_stock`, `add_to_cart`) with multi-hop plans; pluggable providers
  (fake, OpenAI, Anthropic Claude, Google Gemini, Ollama).
- **AI review summaries**: “Customers love X, some complain about Y”, cached per review set,
  with prompt-injection hardening.
- **A/B testing**: deterministic assignment, server-side impression/click logging, CTR per
  variant with a two-proportion z-test in the admin dashboard.
- **Performance**: ISR product pages with on-demand revalidation from the backend, Redis caching,
  server components by default.
- **Production hygiene**: zod-validated config and input, structured JSON logs with redaction,
  global error handler, rate limiting, Helmet security headers, restricted CORS, OpenAPI/Swagger,
  health checks, non-root containers, migrations on start.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js 15 App Router<br/>RSC + Zustand cart + chat widget]
  end
  subgraph Frontend[frontend :20600]
    NX[Next.js server<br/>NextAuth, ISR, image route]
  end
  subgraph Backend[backend :20601]
    API[Express 5 API<br/>zod + OpenAPI]
    ASSIST[Assistant orchestrator<br/>tool calling]
    PAY[Payments<br/>Stripe / mock + webhooks]
    LLM[(LLM provider<br/>fake / OpenAI / Claude / Gemini / Ollama)]
  end
  subgraph ML[ml-service :20602]
    REC[FastAPI recommender<br/>ALS, item-kNN, popularity]
    EMB[Embeddings + semantic search]
    RULES[Association rules]
    JOB[Nightly training job]
  end
  PG[(PostgreSQL :20610)]
  RD[(Redis :20611)]
  MS[(Meilisearch :20612)]
  MF[(MLflow :20613)]
  STRIPE[[Stripe]]

  UI -->|REST + JWT| API
  UI --> NX
  NX -->|server fetch, OAuth exchange| API
  API --> PG
  API --> RD
  API -->|keyword, filters, typo tolerance| MS
  API -->|recs, semantic search| REC
  ASSIST --> LLM
  ASSIST -->|tools| API
  PAY <-->|PaymentIntents / signed webhooks| STRIPE
  REC --> EMB
  REC --> RULES
  JOB -->|read events, orders, products| PG
  JOB -->|params + metrics| MF
  API -.->|revalidate tags| NX
```

Request flow for search: the query parser extracts price/stock constraints → Meilisearch keyword
search and ML semantic search run in parallel → semantic candidates are filtered through
Meilisearch with the same filters → weighted RRF → category-diversity re-rank → hydrated cards.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router, Server Components, ISR), React 19, TypeScript, Tailwind CSS v4, shadcn/ui-style components (Radix), Zustand, NextAuth v4, Stripe Elements, Recharts |
| Backend | Node.js 24, Express 5, TypeScript, Prisma 6, PostgreSQL 16, Redis 7, zod, pino, Helmet, express-rate-limit, Swagger UI |
| Search | Meilisearch 1.16 (keyword, typo tolerance, facets) + embedding search fused with RRF |
| ML | Python 3.12, FastAPI, numpy/scipy ALS, scikit-learn (TF-IDF + SVD embeddings, item-kNN), APScheduler, MLflow 3 |
| AI | Pluggable LLM interface: offline fake (default), OpenAI, Anthropic Claude (`claude-opus-5-5`), Gemini, Ollama |
| Payments | Stripe test mode (PaymentIntents, webhooks) or mock mode with locally signed webhooks |
| Auth | NextAuth (credentials + Google) on top of backend JWT access tokens + rotating refresh tokens, RBAC |
| Testing | Vitest + Supertest (backend), pytest (ML), Vitest + Testing Library (frontend), Playwright (e2e) |
| DevOps | Docker, Docker Compose, GitHub Actions |

## Screenshots

Captured from the running Docker stack with `node scripts/screenshots.mjs` (synthetic data).

**Recommended for you** — personalised ALS picks for the signed-in demo shopper (A/B variant shown top-right).
![Recommended for you](docs/screenshots/home.png)

**Product page** — AI review summary with pros/cons, and "Frequently bought together" from association rules.
![Product page](docs/screenshots/product.png)

**Hybrid search** — "cozy winter outfit under ₹3000" parsed into a price filter and answered by keyword + semantic search.
![Hybrid search](docs/screenshots/search.png)

**AI shopping assistant** — tool calls to search and compare products, rendered as a comparison table.
![AI shopping assistant](docs/screenshots/assistant.png)

**Admin dashboard** — sales charts, A/B test CTR with significance, offline model metrics and inventory alerts.
![Admin dashboard](docs/screenshots/admin.png)

**Dark mode** — the product page in the dark theme.
![Dark mode](docs/screenshots/product-dark.png)

**Mobile** — the product page at 390×844.

<img src="docs/screenshots/mobile-product.png" alt="Mobile product page" width="320">

## Local setup

Prerequisites: Docker Desktop. For running services outside Docker: Node 24, `uv` (Python 3.12).

```bash
cp .env.example .env          # optional — defaults work offline
docker compose up -d --build  # postgres, redis, meilisearch, mlflow, ml-service, backend, frontend
open http://localhost:20600
```

First boot runs migrations, seeds the demo dataset (570 products, 1,913 variants, 7,492 reviews,
401 users, ~24k events, ~1.3k orders), indexes Meilisearch and trains the first model (logged to MLflow).

| URL | What |
|---|---|
| http://localhost:20600 | Storefront |
| http://localhost:20600/admin | Admin dashboard (`admin@shopsense.dev` / `Admin@12345`) |
| http://localhost:20601/api/docs | Swagger UI |
| http://localhost:20602/docs | ML service OpenAPI |
| http://localhost:20613 | MLflow |

Demo customer: `demo@shopsense.dev` / `Demo@12345`. Mock test cards: `4242 4242 4242 4242`
(success), `4000 0000 0000 0002` (decline).

Scripted end-to-end sample of every feature against the running stack:

```bash
scripts/smoke.sh
```

### Running services individually

```bash
docker compose up -d postgres redis meilisearch mlflow

# ML service
cd ml && uv sync -p 3.12
DATABASE_URL=postgresql://shopsense:shopsense@localhost:20610/shopsense \
MLFLOW_TRACKING_URI=http://localhost:20613 uv run uvicorn shopsense_ml.main:app --port 20602

# Backend
cd backend && npm ci && cp ../.env.example .env   # then set the "Local development" values
npx prisma migrate deploy && npm run db:seed && npm run dev

# Frontend
cd frontend && npm ci && npm run dev -- -p 20600
```

### Tests

```bash
cd backend  && npm run lint && npm run typecheck && npm run test:coverage   # needs postgres (shopsense_test db)
cd ml       && uv run ruff check . && uv run mypy src && uv run pytest --cov
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
cd frontend && npx playwright install chromium && npm run test:e2e         # against the running stack
```

## Environment variables

| Variable | Service | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | backend, ml | compose value | PostgreSQL connection |
| `REDIS_URL` | backend | `redis://redis:6379` | Cache (in-memory fallback when empty) |
| `MEILI_HOST` / `MEILI_MASTER_KEY` | backend | compose values | Meilisearch (Postgres search fallback when empty) |
| `ML_SERVICE_URL` / `ML_TIMEOUT_MS` | backend | `http://ml-service:8000` / `3000` | ML service client |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | backend | dev values | Token signing (startup fails in production with dev defaults) |
| `JWT_ACCESS_TTL_SECONDS` / `JWT_REFRESH_TTL_SECONDS` | backend | `900` / `604800` | Token lifetimes |
| `INTERNAL_API_KEY` | backend, frontend | dev value | Server-to-server OAuth exchange |
| `CORS_ORIGINS` | backend | `http://localhost:20600` | Allowed browser origins |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_ASSISTANT_MAX` | backend | `300` / `20` / `30` per minute | Rate limits |
| `LLM_PROVIDER` | backend | `fake` | `fake`, `openai`, `anthropic`, `gemini`, `ollama` |
| `LLM_MODEL` | backend | per provider (`claude-opus-5-5` for Anthropic) | Model override |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `OLLAMA_BASE_URL` | backend | empty | Provider credentials (missing key ⇒ fake) |
| `STRIPE_SECRET_KEY` | backend | empty | Enables live Stripe test mode; empty ⇒ mock mode |
| `STRIPE_WEBHOOK_SECRET` | backend | mock value | Webhook signature secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | frontend | empty | Enables Stripe Elements |
| `FRONTEND_URL` / `FRONTEND_REVALIDATE_SECRET` | backend | compose values | On-demand ISR revalidation |
| `NEXT_PUBLIC_API_URL` / `API_INTERNAL_URL` | frontend | `http://localhost:20601` / `http://backend:4000` | Browser vs server API base |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | frontend | compose values | NextAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | frontend | empty | Google sign-in (hidden when empty) |
| `TRAIN_CRON` | ml | `0 2 * * *` | Nightly retraining (`off` disables) |
| `EMBEDDER` | ml | `lsa` | `lsa`, `hashing`, `sentence-transformers` |
| `MLFLOW_TRACKING_URI` / `MODEL_DIR` | ml | `http://mlflow:5000` / `/app/artifacts` | Tracking and model artefacts |
| `ALS_FACTORS` / `ALS_ITERATIONS` / `ALS_ALPHA` / `ALS_REGULARIZATION` | ml | `32` / `15` / `20` / `0.05` | ALS hyper-parameters |

See `.env.example` for the full list.

## API docs

- Swagger UI: `http://localhost:20601/api/docs` (generated from the same zod schemas that validate requests)
- OpenAPI JSON: `http://localhost:20601/api/openapi.json`
- ML service: `http://localhost:20602/docs`, contract in [`docs/ML_SERVICE_CONTRACT.md`](docs/ML_SERVICE_CONTRACT.md)

## Offline evaluation (seeded dataset)

Temporal hold-out (latest 20 % of each user's items), k = 10, 400 evaluation users,
24,191 interactions, 1,278 baskets, 570 products (fresh `docker compose up`, model retrained
from the admin dashboard):

| Strategy | Precision@10 | Recall@10 | NDCG@10 | Hit rate@10 | Catalogue coverage |
|---|---|---|---|---|---|
| ALS (32 factors) | 0.115 | 0.208 | 0.186 | 0.673 | 0.89 |
| Item-kNN | 0.142 | 0.254 | 0.230 | 0.715 | 0.56 |
| Popularity (cold-start baseline) | 0.020 | 0.038 | 0.029 | 0.178 | 0.03 |

548 association rules were mined from the order baskets.

The data is simulated from latent user preferences, so these numbers validate the pipeline and
relative ranking of strategies, not real-world lift. The live A/B test (ALS vs item-kNN) measures CTR.

## Deployment guide

**Frontend → Vercel**
1. Import the repo, set the root directory to `frontend`.
2. Env: `NEXT_PUBLIC_API_URL` (public backend URL), `API_INTERNAL_URL` (same), `NEXTAUTH_URL`,
   `NEXTAUTH_SECRET`, `INTERNAL_API_KEY`, `REVALIDATE_SECRET`, optional Google and Stripe keys.

**Backend, ML service and data stores → Railway**
1. Create PostgreSQL and Redis plugins; deploy Meilisearch and MLflow from their Docker images
   (attach volumes).
2. Deploy `backend/` (Dockerfile) with the variables above, `NODE_ENV=production`, strong secrets,
   `CORS_ORIGINS=https://<vercel-domain>`, `FRONTEND_URL=https://<vercel-domain>`. Migrations and
   the first-boot seed run from the entrypoint (`SEED_ON_START=false` to disable seeding).
3. Deploy `ml/` (Dockerfile) with `DATABASE_URL`, `MLFLOW_TRACKING_URI`, a volume on `MODEL_DIR`.
4. Stripe: set `STRIPE_SECRET_KEY`, add a webhook endpoint `https://<backend>/api/v1/webhooks/stripe`
   for `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, and set
   `STRIPE_WEBHOOK_SECRET`; set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` on Vercel.
5. LLM: set `LLM_PROVIDER` and the matching API key.

CI (`.github/workflows/ci.yml`) lints, type-checks and tests all three services, then builds the
Docker images and boots the full stack with a smoke test on every push and pull request.

## What I learned / Key engineering decisions

- **Fusion beats choosing**: keyword search is precise for exact terms and typos; embeddings catch
  intent (“cozy”, “for my morning coffee”). Running both and fusing with RRF, after turning prices
  into filters, was far more robust than tuning either alone — and pushing semantic candidates
  back through Meilisearch keeps filters and facets consistent.
- **Make the expensive dependency optional**: every ML call has a timeout and a database fallback,
  so a recommender outage degrades to popularity instead of breaking pages.
- **One payment state machine**: mock mode signs Stripe-shaped events and pushes them through the
  real verification + handler path, so idempotency, out-of-order delivery and stock release are
  tested without Stripe keys.
- **Atomic stock reservation** with a conditional decrement inside the order transaction prevents
  overselling under concurrent checkouts (covered by a race test).
- **Tool-calling assistant as a protocol**: a deterministic fake LLM that speaks the same
  tool-call protocol as hosted models made the orchestrator, tools and UI fully testable offline;
  swapping in Claude or GPT is an env var.
- **Evaluate before you A/B**: offline metrics (ALS ≈ 5.7× and item-kNN ≈ 7× popularity on precision@10) justify the
  candidates; the online A/B test with server-side attribution decides between them.
- More trade-offs and scope notes: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Repository layout

```
frontend/   Next.js storefront + admin
backend/    Express API, Prisma schema/migrations, seed, tests
ml/         FastAPI recommender, training job, tests
infra/      Postgres init (test database)
docs/       Decisions, ML service contract
scripts/    smoke.sh end-to-end sample run
```

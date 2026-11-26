# ML service contract

The Python ML service (`/ml`, FastAPI, internal port 8000, host port 20602) owns every
learned artefact: interaction models, product embeddings, association rules and the
offline evaluation. The Node backend is its only client and treats it as an optional
dependency (every call has a timeout and a database-backed popularity fallback).

## Data it reads (read-only SQL against the shared Postgres)

Tables are created by Prisma (`backend/prisma/schema.prisma`) with snake_case names.

| Table | Columns used |
|---|---|
| `products` | `id`, `name`, `description`, `brand`, `category_id`, `base_price` (int, paise), `tags` (text[]), `rating_avg`, `rating_count`, `is_active`, `created_at` |
| `categories` | `id`, `slug`, `name` |
| `events` | `user_id` (nullable), `session_id`, `type` (`VIEW`/`ADD_TO_CART`/`WISHLIST`/`PURCHASE`), `product_id`, `created_at` |
| `orders` | `id`, `user_id`, `status` (only `PAID`/`SHIPPED`/`DELIVERED` count as baskets), `created_at` |
| `order_items` | `order_id`, `product_id`, `quantity` |

Interaction weights for implicit feedback: VIEW=1, WISHLIST=2, ADD_TO_CART=3, PURCHASE=5.

## HTTP API (JSON, snake_case)

| Method & path | Purpose |
|---|---|
| `GET /health` | `{status:"ok", model_version, trained_at, embedder, n_products}` |
| `GET /models/current` | Metadata of the active model: version, trained_at, params, dataset stats, metrics per strategy (`precision_at_k`, `recall_at_k`, `ndcg_at_k`, `hit_rate_at_k`, `coverage`, `k`) |
| `POST /train` | Run the training job synchronously, return the same payload as `/models/current`. Also runs nightly (`TRAIN_CRON`, default `0 2 * * *`, `off` disables). If the service starts before the DB is seeded it retries the first training every `BOOTSTRAP_RETRY_SECONDS` (30). |
| `POST /index/refresh` | Re-read the catalogue and rebuild embeddings (after product CRUD). |
| `GET /recommend/user?user_id=&recent=id1,id2&k=10&strategy=als\|item_knn\|popularity&exclude=id1,id2` | `{items:[{product_id, score}], strategy, fallback, model_version}`. Seen items are excluded; short lists are topped up with popular items. Known user → requested strategy; unknown user with `recent` items → item-based fold-in; otherwise popularity (`fallback:true`). |
| `GET /similar/{product_id}?k=8` | Content-embedding nearest neighbours `{items:[{product_id, score}]}` |
| `GET /bought-together/{product_id}?k=4` | Association rules `{items:[{product_id, support, confidence, lift}], source:"rules"\|"co_cart"\|"none"}` |
| `GET /popular?k=10&category_id=` | Popularity (recency-decayed weighted interactions) |
| `POST /embed` `{texts:[...]}` | `{vectors:[[...]], dim, embedder}` |
| `POST /search/semantic` `{query, k}` | `{items:[{product_id, score}], embedder}` — cosine over product embeddings |

## Embedders (`EMBEDDER` env)

- `lsa` (default, offline): TF-IDF (word 1–2 grams) + TruncatedSVD fitted on the catalogue.
- `hashing`: stateless HashingVectorizer fallback (used for tiny catalogues).
- `sentence-transformers`: `all-MiniLM-L6-v2`, optional extra, never needed for CI.

## Experiment tracking

Each training run logs params, per-strategy metrics (flattened as `<strategy>_<metric>`, e.g.
`als_ndcg_at_k`), dataset stats and the metadata JSON artefact to MLflow (`MLFLOW_TRACKING_URI`,
defaults to a local `MODEL_DIR/mlruns` file store). MLflow failures are logged and never fail training.
Model bundles are pickled to `MODEL_DIR` (last 3 kept, `current.json` points at the active one)
and loaded on startup.

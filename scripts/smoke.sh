#!/usr/bin/env bash
# End-to-end sample run of every major ShopSense feature against a running stack
# (docker compose up -d). Usage: scripts/smoke.sh [API_BASE] [FRONTEND] [ML] [MLFLOW]
set -uo pipefail

API="${1:-http://localhost:20601}/api/v1"
WEB="${2:-http://localhost:20600}"
ML="${3:-http://localhost:20602}"
MLFLOW="${4:-http://localhost:20613}"
SESSION="smoke$(date +%s)"
PASS=0
FAIL=0
H=(-H "content-type: application/json" -H "x-session-id: ${SESSION}")

ok() { PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
ko() { FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
check() { # name, condition-command...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$name"; else ko "$name"; fi
}
get() { curl -sS --max-time 30 "${H[@]}" "$@"; }
post() { local url="$1"; shift; curl -sS --max-time 120 -X POST "${H[@]}" "$url" "$@"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

section "1. Health"
HEALTH=$(curl -sS --max-time 10 "${API%/api/v1}/health")
echo "  $HEALTH"
check "backend healthy (db, cache, search, ml)" jq -e '.status=="ok" and .checks.database and .checks.cache and .checks.search and .checks.ml' <<<"$HEALTH"
check "ML service healthy" curl -fsS --max-time 10 "$ML/health"
check "MLflow server healthy" curl -fsS --max-time 10 "$MLFLOW/health"
check "frontend home renders" curl -fsS --max-time 30 -o /dev/null "$WEB/"
check "OpenAPI document served" bash -c "curl -fsS '${API%/v1}/openapi.json' | jq -e '.openapi==\"3.1.0\"'"
check "security headers present" bash -c "curl -sSI '${API}/categories' | grep -qi 'x-content-type-options: nosniff'"
check "rate-limit headers present" bash -c "curl -sSI '${API}/categories' | grep -qi '^ratelimit'"

section "2. Catalogue"
CATS=$(get "$API/categories")
echo "  categories: $(jq -r 'map(.name) | join(", ")' <<<"$CATS")"
check "10 categories" jq -e 'length==10' <<<"$CATS"
LIST=$(get "$API/products?pageSize=3&sort=rating")
echo "  products total: $(jq .total <<<"$LIST")"
check "500+ products seeded" jq -e '.total>=500' <<<"$LIST"
SLUG=$(jq -r '.items[0].slug' <<<"$LIST")
DETAIL=$(get "$API/products/$SLUG")
PID=$(jq -r .id <<<"$DETAIL")
echo "  detail: $(jq -r '"\(.name) — \(.variants|length) variants, \(.ratingAvg)★ (\(.ratingCount))"' <<<"$DETAIL")"
check "product detail with variants" jq -e '.variants|length>0' <<<"$DETAIL"
check "product page renders (ISR)" curl -fsS --max-time 30 -o /dev/null "$WEB/p/$SLUG"

section "3. Hybrid search"
S1=$(get "$API/search" -G --data-urlencode "q=cozy winter outfit under ₹3000" --data-urlencode pageSize=5)
echo "  parsed: $(jq -c .parsed <<<"$S1") engines: $(jq -c .engines <<<"$S1")"
jq -r '.items[] | "    - \(.name) ₹\(.price/100)"' <<<"$S1"
check "NL price constraint parsed and applied" jq -e '.parsed.maxPrice==300000 and (.items|length>0) and all(.items[]; .price<=300000)' <<<"$S1"
check "semantic engine contributed" jq -e '.engines.semantic==true and .engines.keyword=="meilisearch"' <<<"$S1"
TYPO=$(get "$API/search/suggest?q=sweatr")
echo "  autocomplete 'sweatr': $(jq -r '[.suggestions[].name][0:2] | join(" | ")' <<<"$TYPO")"
check "typo-tolerant autocomplete" jq -e '[.suggestions[].name] | any(test("Sweater"))' <<<"$TYPO"
check "unicode query handled" bash -c "curl -fsS -G '$API/search' --data-urlencode 'q=जूते 👟' >/dev/null"
check "filters (category + in stock + sort)" bash -c "curl -fsS '$API/search?q=shoes&category=footwear&inStock=true&sort=price_asc' | jq -e 'all(.items[]; .category.slug==\"footwear\")'"

section "4. Recommendations"
COLD=$(get "$API/recommendations/for-you?k=4")
echo "  cold start: strategy=$(jq -r .strategy <<<"$COLD") fallback=$(jq -r .fallback <<<"$COLD") variant=$(jq -r .variant <<<"$COLD")"
check "cold-start popularity fallback" jq -e '.fallback==true and (.items|length==4)' <<<"$COLD"
SIM=$(get "$API/recommendations/similar/$PID?k=4")
echo "  similar to '$(jq -r .name <<<"$DETAIL")': $(jq -r '[.items[].name][0:2] | join(" | ")' <<<"$SIM")"
check "similar items (content embeddings)" jq -e '.strategy=="content_embedding" and (.items|length>0)' <<<"$SIM"
FBT_PID=$(curl -sS "$ML/models/current" >/dev/null; get "$API/products?category=electronics&pageSize=1" | jq -r '.items[0].id')
FBT=$(get "$API/recommendations/bought-together/$FBT_PID?k=3")
echo "  bought together: strategy=$(jq -r .strategy <<<"$FBT") items=$(jq -r '[.items[].name] | join(" | ")' <<<"$FBT")"
check "frequently bought together served" jq -e '.items|type=="array"' <<<"$FBT"

section "5. Auth, events and personalisation"
EMAIL="smoke-${SESSION}@example.test"
REG=$(post "$API/auth/register" -d "{\"email\":\"$EMAIL\",\"password\":\"Smoke12345\",\"name\":\"Smoke Tester\"}")
TOKEN=$(jq -r .accessToken <<<"$REG")
check "register returns JWT pair" jq -e '.accessToken and .refreshToken' <<<"$REG"
REFRESH=$(post "$API/auth/refresh" -d "{\"refreshToken\":\"$(jq -r .refreshToken <<<"$REG")\"}")
check "refresh token rotation" jq -e '.accessToken' <<<"$REFRESH"
TOKEN=$(jq -r .accessToken <<<"$REFRESH")
AUTH=(-H "authorization: Bearer $TOKEN")
EV=$(post "$API/events" "${AUTH[@]}" -d "{\"events\":[{\"type\":\"VIEW\",\"productId\":\"$PID\"},{\"type\":\"VIEW\",\"productId\":\"$(jq -r '.items[0].id' <<<"$SIM")\"}]}")
check "view events tracked" jq -e '.accepted==2' <<<"$EV"
WARM=$(get "$API/recommendations/for-you?k=4" "${AUTH[@]}")
echo "  after 2 views: strategy=$(jq -r .strategy <<<"$WARM") variant=$(jq -r .variant <<<"$WARM") items=$(jq -r '[.items[].name][0:2] | join(" | ")' <<<"$WARM")"
check "session fold-in recommendations" jq -e '.items|length==4' <<<"$WARM"
CLICK=$(post "$API/recommendations/click" "${AUTH[@]}" -d "{\"requestId\":\"$(jq -r .requestId <<<"$WARM")\",\"productId\":\"$(jq -r '.items[0].id' <<<"$WARM")\"}")
check "recommendation click attributed (A/B)" jq -e '.recorded==true' <<<"$CLICK"
check "admin route blocked for customer (403)" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer $TOKEN' '$API/admin/products') = 403 ]"

section "6. Reviews & AI summary"
SUM=$(get "$API/products/$PID/review-summary")
echo "  $(jq -r .summary <<<"$SUM")"
check "review summary generated" jq -e '.summary|length>20' <<<"$SUM"

section "7. Cart, checkout and payments (mock mode, signed webhook path)"
VARIANT=$(get "$API/search?q=running%20shoes&inStock=true&pageSize=1" | jq -r '.items[0].slug' | xargs -I{} curl -sS "$API/products/{}" | jq -r '[.variants[]|select(.stock>2)][0].id')
CART=$(post "$API/cart/items" "${AUTH[@]}" -d "{\"variantId\":\"$VARIANT\",\"quantity\":1,\"unitPrice\":1}")
echo "  cart: $(jq -c '.totals' <<<"$CART")"
check "add to cart (client price ignored)" jq -e '.items[0].unitPrice>1' <<<"$CART"
ADDR='{"shippingAddress":{"fullName":"Smoke Tester","line1":"1 MG Road","city":"Bengaluru","state":"Karnataka","postalCode":"560001","phone":"9876543210"}}'
CO=$(post "$API/checkout" "${AUTH[@]}" -d "$ADDR")
OID=$(jq -r .order.id <<<"$CO")
echo "  order $OID status=$(jq -r .order.status <<<"$CO") total=₹$(jq -r '.order.total/100' <<<"$CO") payment=$(jq -r .payment.mode <<<"$CO")"
check "checkout creates PENDING order" jq -e '.order.status=="PENDING"' <<<"$CO"
PAID=$(post "$API/payments/mock/confirm" "${AUTH[@]}" -d "{\"orderId\":\"$OID\",\"cardNumber\":\"4242 4242 4242 4242\"}")
echo "  history: $(jq -r '[.history[] | "\(.from // "∅")→\(.to)"] | join(", ")' <<<"$PAID")"
check "mock payment → webhook → PAID" jq -e '.status=="PAID"' <<<"$PAID"
post "$API/cart/items" "${AUTH[@]}" -d "{\"variantId\":\"$VARIANT\",\"quantity\":1}" >/dev/null
CO2=$(post "$API/checkout" "${AUTH[@]}" -d "$ADDR")
DECL=$(post "$API/payments/mock/confirm" "${AUTH[@]}" -d "{\"orderId\":\"$(jq -r .order.id <<<"$CO2")\",\"cardNumber\":\"4000 0000 0000 0002\"}")
check "declined card → PAYMENT_FAILED (stock released)" jq -e '.status=="PAYMENT_FAILED"' <<<"$DECL"
check "forged webhook signature rejected (400)" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'stripe-signature: t=1,v1=bad' -d '{}' '$API/webhooks/stripe') = 400 ]"
check "order history lists order" bash -c "curl -fsS -H 'authorization: Bearer $TOKEN' '$API/orders' | jq -e 'map(.id) | index(\"$OID\")'"

section "8. AI shopping assistant (tool calling)"
A1=$(post "$API/assistant/chat" "${AUTH[@]}" -d '{"messages":[{"role":"user","content":"running shoes under 4000"}]}')
echo "  provider=$(jq -r .provider <<<"$A1") tools=$(jq -c '[.toolCalls[].name]' <<<"$A1")"
echo "$(jq -r .reply <<<"$A1" | sed 's/^/    /')"
SHOWN=$(jq -c '[.products[] | {id, slug, name, price}][0:3]' <<<"$A1")
check "assistant search tool" jq -e '.toolCalls[0].name=="search_products" and (.products|length>0)' <<<"$A1"
A2=$(post "$API/assistant/chat" "${AUTH[@]}" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"compare the first two\"}],\"shownProducts\":$SHOWN}")
echo "$(jq -r .reply <<<"$A2" | sed 's/^/    /')"
check "assistant compare tool" jq -e '.toolCalls[0].name=="compare_products" and (.comparison|length==2)' <<<"$A2"
A3=$(post "$API/assistant/chat" "${AUTH[@]}" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"is the first one in stock?\"}],\"shownProducts\":$SHOWN}")
echo "    $(jq -r .reply <<<"$A3")"
check "assistant stock tool" jq -e '.toolCalls[0].name=="check_stock"' <<<"$A3"
A4=$(post "$API/assistant/chat" "${AUTH[@]}" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"add the first one to my cart\"}],\"shownProducts\":$SHOWN}")
echo "    $(jq -r .reply <<<"$A4")"
check "assistant add_to_cart tool" jq -e '.toolCalls[0].name=="add_to_cart"' <<<"$A4"

section "9. Admin"
ADMIN=$(post "$API/auth/login" -d '{"email":"admin@shopsense.dev","password":"Admin@12345"}' | jq -r .accessToken)
AA=(-H "authorization: Bearer $ADMIN")
SALES=$(get "$API/admin/analytics/sales?days=30" "${AA[@]}")
echo "  last 30d: revenue=₹$(jq -r '.revenue/100' <<<"$SALES") orders=$(jq -r .orders <<<"$SALES") AOV=₹$(jq -r '.averageOrderValue/100' <<<"$SALES")"
check "sales analytics" jq -e '.orders>0 and (.daily|length>0)' <<<"$SALES"
INV=$(get "$API/admin/inventory/alerts" "${AA[@]}")
echo "  inventory alerts: $(jq -r .count <<<"$INV")"
check "inventory alerts" jq -e '.count>0' <<<"$INV"
EXP=$(get "$API/admin/experiments" "${AA[@]}")
echo "  A/B: $(jq -r '[.variants[] | "\(.variant)=\(.strategy) imp=\(.impressions) clk=\(.clicks) ctr=\(.ctr*1000|round/10)%"] | join("; ")' <<<"$EXP")"
check "A/B CTR dashboard data" jq -e '([.variants[].impressions]|add)>0' <<<"$EXP"
NEWP=$(post "$API/admin/products" "${AA[@]}" -d "{\"name\":\"Smoke Test Cotton Tee\",\"description\":\"Created by the smoke test.\",\"brand\":\"Smoke\",\"categoryId\":\"$(jq -r '.[0].id' <<<"$CATS")\",\"basePrice\":49900,\"variants\":[{\"sku\":\"SMOKE-$SESSION\",\"stock\":3}]}")
check "admin product create" jq -e '.id' <<<"$NEWP"
check "admin product archive" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H 'authorization: Bearer $ADMIN' '$API/admin/products/$(jq -r .id <<<"$NEWP")') = 204 ]"
SHIP=$(curl -sS -X PATCH "${H[@]}" "${AA[@]}" "$API/admin/orders/$OID/status" -d '{"status":"SHIPPED"}')
check "admin ships order (state machine)" jq -e '.status=="SHIPPED"' <<<"$SHIP"

section "10. ML model, retraining and MLflow"
MODEL=$(get "$API/admin/ml/model" "${AA[@]}")
echo "  model $(jq -r .version <<<"$MODEL"):"
jq -r '.metrics | to_entries[] | "    \(.key): P@10=\(.value.precision_at_k*1000|round/1000) R@10=\(.value.recall_at_k*1000|round/1000) NDCG@10=\(.value.ndcg_at_k*1000|round/1000)"' <<<"$MODEL"
check "model metrics available" jq -e '.metrics.als.precision_at_k > .metrics.popularity.precision_at_k' <<<"$MODEL"
TRAIN=$(post "$API/admin/ml/train" "${AA[@]}")
echo "  retrained → $(jq -r .version <<<"$TRAIN") on $(jq -r .dataset.n_interactions <<<"$TRAIN") interactions"
check "retraining job" jq -e '.version' <<<"$TRAIN"
EXP_ID=$(curl -sS "$MLFLOW/api/2.0/mlflow/experiments/get-by-name?experiment_name=shopsense-recommender" | jq -r .experiment.experiment_id)
RUNS=$(curl -sS -X POST -H 'content-type: application/json' "$MLFLOW/api/2.0/mlflow/runs/search" -d "{\"experiment_ids\":[\"$EXP_ID\"],\"max_results\":5}")
echo "  MLflow runs visible: $(jq '.runs|length' <<<"$RUNS")"
check "runs logged to MLflow" jq -e '.runs|length>0' <<<"$RUNS"

section "11. Frontend pages"
for path in "/" "/search?q=cozy%20winter%20outfit%20under%203000" "/c/footwear" "/cart" "/login" "/p/$SLUG"; do
  check "GET $path → 200" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 '$WEB$path') = 200 ]"
done

printf '\n\033[1mSummary: %d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]

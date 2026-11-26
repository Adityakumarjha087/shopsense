"""Deterministic synthetic catalogue + interaction generator.

Users have latent preferences over (category, style) clusters, so collaborative
filtering has real structure to recover; a fixed set of complementary product
pairs is co-purchased so association rules have something to find.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np

from shopsense_ml.data.repository import Basket, Dataset, Interaction, Product

CATEGORY_WORDS: dict[str, list[str]] = {
    "Outerwear": ["jacket", "coat", "parka", "winter", "warm", "cozy", "fleece", "wool"],
    "Footwear": ["sneaker", "boot", "running", "shoe", "trail", "cushioned", "leather"],
    "Electronics": ["wireless", "earbuds", "speaker", "charger", "bluetooth", "battery"],
    "Kitchen": ["skillet", "kettle", "knife", "ceramic", "cookware", "steel", "brew"],
    "Beauty": ["serum", "moisturiser", "hydrating", "skin", "gentle", "fragrance"],
    "Sports": ["yoga", "mat", "dumbbell", "training", "fitness", "grip", "outdoor"],
}
STYLES = ["classic", "urban", "eco", "premium"]
TYPES = ["VIEW", "VIEW", "VIEW", "VIEW", "WISHLIST", "ADD_TO_CART", "ADD_TO_CART", "PURCHASE"]


@dataclass(frozen=True, slots=True)
class SyntheticConfig:
    n_products_per_category: int = 24
    n_users: int = 300
    events_per_user: tuple[int, int] = (12, 40)
    n_anonymous_sessions: int = 60
    preference_strength: float = 0.85
    n_complementary_pairs: int = 20
    days: int = 90
    seed: int = 7


def generate(config: SyntheticConfig | None = None) -> Dataset:
    cfg = config or SyntheticConfig()
    rng = np.random.default_rng(cfg.seed)
    start = datetime(2026, 1, 1, tzinfo=UTC)

    products: list[Product] = []
    cluster_of: dict[str, tuple[int, int]] = {}
    for c_idx, (category, words) in enumerate(CATEGORY_WORDS.items()):
        for i in range(cfg.n_products_per_category):
            style_idx = i % len(STYLES)
            style = STYLES[style_idx]
            picked = rng.choice(words, size=3, replace=False).tolist()
            pid = f"p{c_idx:02d}{i:03d}"
            products.append(
                Product(
                    id=pid,
                    name=f"{style.title()} {picked[0].title()} {i}",
                    description=(
                        f"A {style} {' '.join(picked)} for everyday use in {category.lower()}."
                    ),
                    brand=f"Brand{(i * 7 + c_idx) % 9}",
                    category_id=f"cat-{c_idx}",
                    category=category,
                    base_price=int(rng.integers(500, 15000)) * 100,
                    tags=(style, picked[1]),
                    rating_avg=round(float(rng.uniform(3.0, 5.0)), 1),
                    rating_count=int(rng.integers(0, 200)),
                    created_at=start,
                )
            )
            cluster_of[pid] = (c_idx, style_idx)

    by_cluster: dict[tuple[int, int], list[str]] = {}
    for pid, cl in cluster_of.items():
        by_cluster.setdefault(cl, []).append(pid)
    all_ids = [p.id for p in products]
    clusters = sorted(by_cluster)
    # Popularity skew inside each cluster (Zipf-ish).
    item_pop = {pid: 1.0 / (1 + (int(pid[-3:]) // len(STYLES))) ** 0.6 for pid in all_ids}

    pair_idx = rng.choice(len(all_ids), size=(cfg.n_complementary_pairs, 2), replace=False)
    pairs = [(all_ids[a], all_ids[b]) for a, b in pair_idx]
    partner = {a: b for a, b in pairs} | {b: a for a, b in pairs}

    interactions: list[Interaction] = []
    baskets: list[Basket] = []
    order_no = 0

    def pick_item(user_clusters: list[tuple[int, int]]) -> str:
        if rng.random() < cfg.preference_strength:
            cl = user_clusters[int(rng.integers(len(user_clusters)))]
            pool = by_cluster[cl]
        else:
            pool = all_ids
        weights = np.array([item_pop[p] for p in pool])
        return str(pool[int(rng.choice(len(pool), p=weights / weights.sum()))])

    def emit(
        actor: str | None, session: str, n_events: int, user_clusters: list[tuple[int, int]]
    ) -> None:
        nonlocal order_no
        t = start + timedelta(days=float(rng.uniform(0, cfg.days / 3)))
        for _ in range(n_events):
            t += timedelta(hours=float(rng.exponential(30)))
            pid = pick_item(user_clusters)
            etype = str(TYPES[int(rng.integers(len(TYPES)))])
            interactions.append(Interaction(actor, session, etype, pid, t))
            if etype == "PURCHASE":
                items = [pid]
                if pid in partner and rng.random() < 0.7:
                    items.append(partner[pid])
                    interactions.append(Interaction(actor, session, "PURCHASE", partner[pid], t))
                order_no += 1
                baskets.append(Basket(f"o{order_no:05d}", tuple(items), t))

    for u in range(cfg.n_users):
        n_pref = int(rng.integers(1, 3))
        user_clusters = [clusters[int(i)] for i in rng.choice(len(clusters), n_pref, replace=False)]
        n_events = int(rng.integers(cfg.events_per_user[0], cfg.events_per_user[1] + 1))
        emit(f"u{u:04d}", f"s{u:04d}", n_events, user_clusters)
    for s in range(cfg.n_anonymous_sessions):
        user_clusters = [clusters[int(rng.integers(len(clusters)))]]
        emit(None, f"anon{s:04d}", int(rng.integers(2, 8)), user_clusters)

    interactions.sort(key=lambda e: e.created_at)
    return Dataset(products=products, interactions=interactions, baskets=baskets)

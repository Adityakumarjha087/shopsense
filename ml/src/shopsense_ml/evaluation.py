"""Temporal hold-out split and ranking metrics."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from shopsense_ml.data.repository import Interaction


@dataclass(frozen=True, slots=True)
class Split:
    train: list[Interaction]
    test: dict[str, set[str]]  # actor -> held-out items


def temporal_split(
    interactions: Sequence[Interaction], holdout_fraction: float = 0.2, min_items: int = 5
) -> Split:
    """Hold out each eligible user's most recently *discovered* distinct items.

    Only logged-in users with >= ``min_items`` distinct items are evaluated; all of a
    held-out item's interactions are removed from the training set to avoid leakage.
    """
    first_seen: dict[str, dict[str, Interaction]] = defaultdict(dict)
    for ev in sorted(interactions, key=lambda e: e.created_at):
        if ev.user_id is None:
            continue
        first_seen[ev.actor].setdefault(ev.product_id, ev)
    test: dict[str, set[str]] = {}
    for actor, items in first_seen.items():
        if len(items) < min_items:
            continue
        ordered = sorted(items.values(), key=lambda e: e.created_at)
        n_test = max(1, math.ceil(len(ordered) * holdout_fraction))
        test[actor] = {e.product_id for e in ordered[-n_test:]}
    train = [ev for ev in interactions if ev.product_id not in test.get(ev.actor, set())]
    return Split(train=train, test=test)


def precision_at_k(recommended: Sequence[str], relevant: set[str], k: int) -> float:
    if k <= 0:
        return 0.0
    return sum(1 for r in recommended[:k] if r in relevant) / k


def recall_at_k(recommended: Sequence[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    return sum(1 for r in recommended[:k] if r in relevant) / len(relevant)


def ndcg_at_k(recommended: Sequence[str], relevant: set[str], k: int) -> float:
    dcg = sum(1.0 / math.log2(i + 2) for i, r in enumerate(recommended[:k]) if r in relevant)
    ideal = sum(1.0 / math.log2(i + 2) for i in range(min(len(relevant), k)))
    return dcg / ideal if ideal > 0 else 0.0


def hit_rate_at_k(recommended: Sequence[str], relevant: set[str], k: int) -> float:
    return 1.0 if any(r in relevant for r in recommended[:k]) else 0.0


def evaluate(
    recommend: Callable[[str, int], list[str]],
    test: dict[str, set[str]],
    k: int,
    n_items: int,
) -> dict[str, float]:
    """Average per-user metrics for a ``recommend(actor, k)`` callable."""
    if not test:
        return {
            "precision_at_k": 0.0,
            "recall_at_k": 0.0,
            "ndcg_at_k": 0.0,
            "hit_rate_at_k": 0.0,
            "coverage": 0.0,
            "n_eval_users": 0.0,
            "k": float(k),
        }
    p = r = n = h = 0.0
    seen: set[str] = set()
    for actor, relevant in test.items():
        recs = recommend(actor, k)
        seen.update(recs)
        p += precision_at_k(recs, relevant, k)
        r += recall_at_k(recs, relevant, k)
        n += ndcg_at_k(recs, relevant, k)
        h += hit_rate_at_k(recs, relevant, k)
    users = len(test)
    return {
        "precision_at_k": p / users,
        "recall_at_k": r / users,
        "ndcg_at_k": n / users,
        "hit_rate_at_k": h / users,
        "coverage": len(seen) / n_items if n_items else 0.0,
        "n_eval_users": float(users),
        "k": float(k),
    }

"""Pairwise association rules ("frequently bought together")."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from itertools import permutations

from shopsense_ml.data.repository import Interaction


@dataclass(frozen=True, slots=True)
class Rule:
    antecedent: str
    consequent: str
    support: float
    confidence: float
    lift: float
    count: int


@dataclass(slots=True)
class AssociationRules:
    min_support: float = 0.002
    min_confidence: float = 0.05
    min_count: int = 2
    n_baskets: int = 0
    rules: dict[str, list[Rule]] = field(default_factory=dict)

    def fit(self, baskets: Iterable[Sequence[str]]) -> AssociationRules:
        item_counts: Counter[str] = Counter()
        pair_counts: Counter[tuple[str, str]] = Counter()
        n = 0
        for basket in baskets:
            items = sorted(set(basket))
            if not items:
                continue
            n += 1
            item_counts.update(items)
            if len(items) > 1:
                pair_counts.update(permutations(items, 2))
        self.n_baskets = n
        self.rules = {}
        if n == 0:
            return self
        min_count = max(self.min_count, int(self.min_support * n + 0.999999))
        for (a, b), count in pair_counts.items():
            if count < min_count:
                continue
            support = count / n
            confidence = count / item_counts[a]
            if confidence < self.min_confidence:
                continue
            lift = confidence / (item_counts[b] / n)
            self.rules.setdefault(a, []).append(Rule(a, b, support, confidence, lift, count))
        for lst in self.rules.values():
            lst.sort(key=lambda r: (-r.lift * r.confidence, -r.count, r.consequent))
        return self

    def for_item(self, product_id: str, k: int) -> list[Rule]:
        return self.rules.get(product_id, [])[:k]


def session_cart_baskets(interactions: Iterable[Interaction]) -> list[list[str]]:
    """Fallback baskets: items added to cart / purchased within the same session."""
    by_session: dict[str, list[str]] = {}
    for ev in interactions:
        if ev.type in ("ADD_TO_CART", "PURCHASE"):
            by_session.setdefault(ev.session_id, []).append(ev.product_id)
    return [items for items in by_session.values() if len(set(items)) > 1]

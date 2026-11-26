"""Model bundle: all fitted artefacts plus the serving-time ranking logic."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

import numpy as np

from shopsense_ml.data.repository import Product
from shopsense_ml.models.als import ALSModel
from shopsense_ml.models.embeddings import Embedder, VectorIndex
from shopsense_ml.models.item_knn import ItemKNNModel
from shopsense_ml.models.matrix import InteractionMatrix, top_k
from shopsense_ml.models.popularity import PopularityModel
from shopsense_ml.models.rules import AssociationRules

Strategy = Literal["als", "item_knn", "popularity"]
STRATEGIES: tuple[Strategy, ...] = ("als", "item_knn", "popularity")


@dataclass(slots=True)
class Recommendation:
    items: list[tuple[str, float]]
    strategy: str
    fallback: bool


@dataclass(slots=True)
class ContentIndex:
    embedder: Embedder
    index: VectorIndex
    category_of: dict[str, str]


@dataclass(slots=True)
class ModelBundle:
    version: str
    trained_at: datetime
    matrix: InteractionMatrix
    als: ALSModel
    knn: ItemKNNModel
    popularity: PopularityModel
    rules: AssociationRules
    co_cart: AssociationRules
    content: ContentIndex
    metadata: dict[str, Any] = field(default_factory=dict)

    # ---- collaborative filtering -------------------------------------------------
    def _user_vector(self, user_id: str | None, recent: Sequence[str]) -> np.ndarray:
        vec = self.matrix.row(user_id) if user_id else np.zeros(self.matrix.n_items)
        if recent:
            vec = vec + self.matrix.vector_from_items(recent, weight=2.0)
        return vec

    def _scores(self, strategy: Strategy, vec: np.ndarray, stored_user: int | None) -> np.ndarray:
        """Score every item. ``stored_user`` is set when trained ALS factors can be reused."""
        if strategy == "als":
            if stored_user is not None:
                return self.als.score_user(stored_user)
            return self.als.score_vector(self.als.fold_in(vec))
        if strategy == "item_knn":
            return self.knn.score_vector(vec)
        return self.popularity_vector()

    def popularity_vector(self) -> np.ndarray:
        index = self.matrix.item_index
        out = np.zeros(self.matrix.n_items)
        for pid, score in zip(self.popularity.item_ids, self.popularity.scores, strict=True):
            i = index.get(pid)
            if i is not None:
                out[i] = score
        return out

    def recommend(
        self,
        user_id: str | None,
        recent: Sequence[str] = (),
        k: int = 10,
        strategy: Strategy = "als",
        exclude: Iterable[str] = (),
    ) -> Recommendation:
        vec = self._user_vector(user_id, recent)
        excluded = np.zeros(self.matrix.n_items, dtype=bool)
        excluded[vec > 0] = True
        for pid in exclude:
            i = self.matrix.item_index.get(pid)
            if i is not None:
                excluded[i] = True
        known = bool(user_id and user_id in self.matrix.user_index)
        has_signal = bool(vec.any()) and self.matrix.matrix.nnz > 0
        use, fallback = strategy, False
        if strategy != "popularity" and not (known or has_signal):
            use, fallback = "popularity", True
        stored = self.matrix.user_index.get(user_id) if (user_id and not recent) else None
        scores = self._scores(use, vec, stored)
        if use != "popularity" and not np.any(scores[~excluded] > 0):
            use, fallback = "popularity", True
            scores = self.popularity_vector()
        idx = top_k(scores, k, excluded)
        items = [(self.matrix.items[i], float(scores[i])) for i in idx]
        if len(items) < k and use != "popularity":
            # Top up with popular items so carousels are always full.
            have = {pid for pid, _ in items} | {
                self.matrix.items[i] for i in np.flatnonzero(excluded)
            }
            for pid, _score in self.popular(k + int(excluded.sum()) + len(items)):
                if pid not in have:
                    items.append((pid, 0.0))
                    have.add(pid)
                if len(items) >= k:
                    break
        return Recommendation(items=items, strategy=use, fallback=fallback)

    def recommend_ids(self, actor: str, k: int, strategy: Strategy) -> list[str]:
        """Evaluation helper: recommendations for a training actor, seen items excluded."""
        return [pid for pid, _ in self.recommend(actor, (), k, strategy).items]

    def popular(self, k: int, category_id: str | None = None) -> list[tuple[str, float]]:
        allowed = None
        if category_id is not None:
            allowed = {pid for pid, c in self.content.category_of.items() if c == category_id}
        return self.popularity.ranked(allowed)[:k]

    # ---- content ------------------------------------------------------------------
    def similar(self, product_id: str, k: int) -> list[tuple[str, float]] | None:
        return self.content.index.similar(product_id, k)

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        return self.content.embedder.encode(list(texts))

    def semantic_search(self, query: str, k: int) -> list[tuple[str, float]]:
        vec = self.embed([query])
        if vec.shape[0] == 0:
            return []
        return [(pid, s) for pid, s in self.content.index.query(vec[0], k) if s > 0]

    def bought_together(self, product_id: str, k: int) -> tuple[list[dict[str, float | str]], str]:
        for source, model in (("rules", self.rules), ("co_cart", self.co_cart)):
            found = model.for_item(product_id, k)
            if found:
                return (
                    [
                        {
                            "product_id": r.consequent,
                            "support": r.support,
                            "confidence": r.confidence,
                            "lift": r.lift,
                        }
                        for r in found
                    ],
                    source,
                )
        return [], "none"


def build_content_index(products: Sequence[Product], embedder: Embedder) -> ContentIndex:
    ids = [p.id for p in products]
    vectors = embedder.encode([p.text() for p in products]) if products else np.zeros((0, 1))
    return ContentIndex(
        embedder=embedder,
        index=VectorIndex(ids, vectors),
        category_of={p.id: p.category_id for p in products},
    )


def new_version() -> str:
    return datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")

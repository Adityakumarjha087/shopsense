"""Recency-decayed popularity with a Bayesian rating prior for cold catalogues."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from shopsense_ml.data.repository import Interaction, Product
from shopsense_ml.models.matrix import FloatArray


@dataclass(slots=True)
class PopularityModel:
    half_life_days: float = 14.0
    item_ids: list[str] = field(default_factory=list)
    scores: FloatArray = field(default_factory=lambda: np.zeros(0))

    def fit(
        self,
        interactions: Sequence[Interaction],
        products: Sequence[Product],
        now: datetime | None = None,
    ) -> PopularityModel:
        self.item_ids = [p.id for p in products]
        index = {pid: i for i, pid in enumerate(self.item_ids)}
        scores = np.zeros(len(self.item_ids))
        if interactions:
            ref = now or max(ev.created_at for ev in interactions)
            for ev in interactions:
                idx = index.get(ev.product_id)
                if idx is None:
                    continue
                age_days = max((ref - ev.created_at).total_seconds() / 86400.0, 0.0)
                scores[idx] += ev.weight * 0.5 ** (age_days / self.half_life_days)
        # Tie-breaker / cold start: Bayesian average rating weighted by review volume.
        if products:
            counts = np.array([p.rating_count for p in products], dtype=np.float64)
            ratings = np.array([p.rating_avg for p in products], dtype=np.float64)
            m = float(counts.mean()) if counts.size else 0.0
            c = float((ratings * counts).sum() / counts.sum()) if counts.sum() > 0 else 0.0
            bayes = (counts * ratings + m * c) / np.maximum(counts + m, 1e-9)
            prior = bayes * np.log1p(counts)
            if prior.max() > 0:
                prior = prior / prior.max()
            scale = scores.max() if scores.max() > 0 else 1.0
            scores = scores + 1e-3 * scale * prior
        self.scores = scores
        return self

    def ranked(self, allowed: set[str] | None = None) -> list[tuple[str, float]]:
        order = np.argsort(-self.scores, kind="stable")
        out: list[tuple[str, float]] = []
        for i in order:
            pid = self.item_ids[int(i)]
            if allowed is None or pid in allowed:
                out.append((pid, float(self.scores[int(i)])))
        return out

"""Sparse user x item matrix of implicit-feedback weights."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy import sparse

from shopsense_ml.data.repository import Interaction

FloatArray = npt.NDArray[np.float64]


@dataclass(slots=True)
class InteractionMatrix:
    users: list[str]
    items: list[str]
    user_index: dict[str, int]
    item_index: dict[str, int]
    matrix: sparse.csr_matrix  # shape (n_users, n_items), summed event weights

    @classmethod
    def build(
        cls, interactions: Iterable[Interaction], item_ids: Sequence[str]
    ) -> InteractionMatrix:
        items = list(dict.fromkeys(item_ids))
        item_index = {pid: i for i, pid in enumerate(items)}
        user_index: dict[str, int] = {}
        rows: list[int] = []
        cols: list[int] = []
        vals: list[float] = []
        for ev in interactions:
            col = item_index.get(ev.product_id)
            if col is None:
                continue
            row = user_index.setdefault(ev.actor, len(user_index))
            rows.append(row)
            cols.append(col)
            vals.append(ev.weight)
        mat = sparse.csr_matrix(
            (np.asarray(vals, dtype=np.float64), (rows, cols)),
            shape=(len(user_index), len(items)),
        )
        mat.sum_duplicates()
        users = sorted(user_index, key=user_index.__getitem__)
        return cls(users, items, user_index, item_index, mat)

    @property
    def n_users(self) -> int:
        return len(self.users)

    @property
    def n_items(self) -> int:
        return len(self.items)

    def row(self, user: str) -> FloatArray:
        idx = self.user_index.get(user)
        if idx is None:
            return np.zeros(self.n_items)
        return np.asarray(self.matrix.getrow(idx).toarray()).ravel()

    def vector_from_items(self, product_ids: Iterable[str], weight: float = 1.0) -> FloatArray:
        vec = np.zeros(self.n_items)
        for pid in product_ids:
            idx = self.item_index.get(pid)
            if idx is not None:
                vec[idx] += weight
        return vec


def top_k(scores: FloatArray, k: int, exclude: npt.NDArray[np.bool_] | None = None) -> list[int]:
    """Indices of the k largest finite scores, skipping excluded positions."""
    s = scores.astype(np.float64, copy=True)
    if exclude is not None:
        s[exclude] = -np.inf
    k = min(k, int(np.isfinite(s).sum()))
    if k <= 0:
        return []
    part = np.argpartition(-s, k - 1)[:k]
    return [int(i) for i in part[np.argsort(-s[part], kind="stable")]]

"""Item-item collaborative filtering with cosine similarity on the interaction matrix."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import sparse
from sklearn.preprocessing import normalize

from shopsense_ml.models.matrix import FloatArray


@dataclass(slots=True)
class ItemKNNModel:
    neighbours: int = 50
    shrinkage: float = 10.0
    similarity: sparse.csr_matrix = field(default_factory=lambda: sparse.csr_matrix((0, 0)))

    def fit(self, matrix: sparse.csr_matrix) -> ItemKNNModel:
        binary = matrix.copy().astype(np.float64)
        binary.data = np.log1p(binary.data)
        item_user = normalize(binary.T.tocsr(), norm="l2", axis=1)
        sim = (item_user @ item_user.T).tocsr()
        sim.setdiag(0.0)
        sim.eliminate_zeros()
        # Support-based shrinkage: s_ij * n_ij / (n_ij + lambda) damps similarities
        # that rest on very few co-occurring users.
        occurs = (binary > 0).astype(np.float64)
        co = (occurs.T @ occurs).tocsr()
        co.data = co.data / (co.data + self.shrinkage)
        sim = sim.multiply(co).tocsr()
        self.similarity = self._prune(sim)
        return self

    def _prune(self, sim: sparse.csr_matrix) -> sparse.csr_matrix:
        rows: list[int] = []
        cols: list[int] = []
        vals: list[float] = []
        for i in range(sim.shape[0]):
            start, end = sim.indptr[i], sim.indptr[i + 1]
            if start == end:
                continue
            idx = sim.indices[start:end]
            data = sim.data[start:end]
            if idx.size > self.neighbours:
                keep = np.argpartition(-data, self.neighbours - 1)[: self.neighbours]
                idx, data = idx[keep], data[keep]
            rows.extend([i] * idx.size)
            cols.extend(idx.tolist())
            vals.extend(data.tolist())
        return sparse.csr_matrix((vals, (rows, cols)), shape=sim.shape)

    def score_vector(self, user_vec: FloatArray) -> FloatArray:
        if self.similarity.shape[0] == 0:
            return np.zeros_like(user_vec)
        weights = np.log1p(np.maximum(user_vec, 0.0))
        return np.asarray(self.similarity.T @ weights).ravel()

    def neighbours_of(self, item_idx: int) -> list[tuple[int, float]]:
        row = self.similarity.getrow(item_idx)
        pairs = sorted(
            zip(row.indices.tolist(), row.data.tolist(), strict=True), key=lambda p: -p[1]
        )
        return [(int(i), float(s)) for i, s in pairs]

"""Implicit-feedback ALS (Hu, Koren & Volinsky, 2008) in plain numpy.

Confidence c_ui = 1 + alpha * r_ui, preference p_ui = 1[r_ui > 0]. Each half-step
solves the regularised weighted least squares problem exactly using the
Y^T Y + Y^T (C_u - I) Y trick, so the cost per user is O(n_u * f^2 + f^3).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import sparse

from shopsense_ml.models.matrix import FloatArray


@dataclass(slots=True)
class ALSModel:
    factors: int = 32
    regularization: float = 0.05
    alpha: float = 20.0
    iterations: int = 15
    seed: int = 42
    user_factors: FloatArray = field(default_factory=lambda: np.zeros((0, 0)))
    item_factors: FloatArray = field(default_factory=lambda: np.zeros((0, 0)))
    loss_history: list[float] = field(default_factory=list)

    def fit(self, matrix: sparse.csr_matrix) -> ALSModel:
        n_users, n_items = matrix.shape
        rng = np.random.default_rng(self.seed)
        scale = 0.01
        x = rng.normal(0, scale, (n_users, self.factors))
        y = rng.normal(0, scale, (n_items, self.factors))
        # Log-scaling tames heavy users / repeated views before confidence weighting.
        conf = matrix.copy().astype(np.float64)
        conf.data = self.alpha * np.log1p(conf.data)
        conf_t = conf.T.tocsr()
        self.loss_history = []
        for _ in range(self.iterations):
            x = self._solve(conf, y)
            y = self._solve(conf_t, x)
            self.loss_history.append(self._loss(conf, x, y))
        self.user_factors, self.item_factors = x, y
        return self

    def _solve(self, conf: sparse.csr_matrix, fixed: FloatArray) -> FloatArray:
        f = fixed.shape[1]
        gram = fixed.T @ fixed
        reg = self.regularization * np.eye(f)
        out = np.zeros((conf.shape[0], f))
        indptr, indices, data = conf.indptr, conf.indices, conf.data
        for u in range(conf.shape[0]):
            start, end = indptr[u], indptr[u + 1]
            if start == end:
                continue
            idx = indices[start:end]
            c = data[start:end]  # this is (c_ui - 1)
            yu = fixed[idx]
            a = gram + (yu.T * c) @ yu + reg
            b = yu.T @ (c + 1.0)
            out[u] = np.linalg.solve(a, b)
        return out

    def _loss(self, conf: sparse.csr_matrix, x: FloatArray, y: FloatArray) -> float:
        # Loss over observed entries + L2 (unobserved part omitted: monitoring only).
        coo = conf.tocoo()
        pred = np.einsum("ij,ij->i", x[coo.row], y[coo.col])
        loss = float(np.sum((coo.data + 1.0) * (1.0 - pred) ** 2))
        loss += self.regularization * float(np.sum(x * x) + np.sum(y * y))
        return loss

    def fold_in(self, interactions: FloatArray) -> FloatArray:
        """Latent vector for an unseen user from a dense item-weight vector."""
        if self.item_factors.size == 0:
            return np.zeros(self.factors)
        idx = np.flatnonzero(interactions > 0)
        if idx.size == 0:
            return np.zeros(self.item_factors.shape[1])
        c = self.alpha * np.log1p(interactions[idx])
        yu = self.item_factors[idx]
        f = self.item_factors.shape[1]
        a = (
            self.item_factors.T @ self.item_factors
            + (yu.T * c) @ yu
            + self.regularization * np.eye(f)
        )
        b = yu.T @ (c + 1.0)
        return np.asarray(np.linalg.solve(a, b))

    def score_user(self, user_idx: int) -> FloatArray:
        return np.asarray(self.item_factors @ self.user_factors[user_idx])

    def score_vector(self, user_vec: FloatArray) -> FloatArray:
        return np.asarray(self.item_factors @ user_vec)

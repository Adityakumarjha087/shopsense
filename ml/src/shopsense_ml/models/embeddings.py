"""Product/query text embedders.

* ``lsa`` (default): TF-IDF over word 1-2 grams + TruncatedSVD fitted on the catalogue,
  so terms that co-occur in descriptions ("cozy", "fleece", "winter") end up close.
* ``hashing``: stateless HashingVectorizer, used when the catalogue is too small for SVD.
* ``sentence-transformers``: optional neural encoder (``pip install .[transformers]``).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Protocol

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import HashingVectorizer, TfidfVectorizer
from sklearn.preprocessing import normalize

from shopsense_ml.models.matrix import FloatArray

_TOKEN = re.compile(r"[a-z0-9]+")


def preprocess(text: str) -> str:
    return " ".join(_TOKEN.findall(text.lower()))


def l2(x: FloatArray) -> FloatArray:
    return np.asarray(normalize(np.asarray(x, dtype=np.float64), norm="l2", axis=1))


class Embedder(Protocol):
    name: str

    @property
    def dim(self) -> int: ...

    def fit(self, texts: Sequence[str]) -> Embedder: ...

    def encode(self, texts: Sequence[str]) -> FloatArray: ...


class HashingEmbedder:
    name = "hashing"

    def __init__(self, dim: int = 512) -> None:
        self._dim = dim
        self._vec = HashingVectorizer(
            n_features=dim,
            ngram_range=(1, 2),
            alternate_sign=False,
            norm=None,
            preprocessor=preprocess,
        )

    @property
    def dim(self) -> int:
        return self._dim

    def fit(self, texts: Sequence[str]) -> HashingEmbedder:
        return self

    def encode(self, texts: Sequence[str]) -> FloatArray:
        if not texts:
            return np.zeros((0, self._dim))
        mat = self._vec.transform(list(texts))
        mat.data = np.log1p(mat.data)
        return l2(mat.toarray())


class LSAEmbedder:
    name = "lsa"
    min_docs = 8

    def __init__(self, dim: int = 96, seed: int = 42) -> None:
        self.requested_dim = dim
        self.seed = seed
        self._tfidf = TfidfVectorizer(
            preprocessor=preprocess,
            ngram_range=(1, 2),
            sublinear_tf=True,
            stop_words="english",
            min_df=1,
        )
        self._svd: TruncatedSVD | None = None
        self._dim = 0

    @property
    def dim(self) -> int:
        return self._dim

    def fit(self, texts: Sequence[str]) -> LSAEmbedder:
        if len(texts) < self.min_docs:
            raise ValueError(f"LSA needs at least {self.min_docs} documents, got {len(texts)}")
        tfidf = self._tfidf.fit_transform(list(texts))
        n_comp = max(2, min(self.requested_dim, tfidf.shape[0] - 1, tfidf.shape[1] - 1))
        self._svd = TruncatedSVD(n_components=n_comp, random_state=self.seed)
        self._svd.fit(tfidf)
        self._dim = n_comp
        return self

    def encode(self, texts: Sequence[str]) -> FloatArray:
        if self._svd is None:
            raise RuntimeError("LSAEmbedder.encode called before fit")
        if not texts:
            return np.zeros((0, self._dim))
        reduced = np.asarray(self._svd.transform(self._tfidf.transform(list(texts))))
        return l2(reduced)


class SentenceTransformerEmbedder:  # pragma: no cover - optional heavy dependency
    name = "sentence-transformers"

    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name)
        self._dim = int(self._model.get_sentence_embedding_dimension() or 384)

    @property
    def dim(self) -> int:
        return self._dim

    def fit(self, texts: Sequence[str]) -> SentenceTransformerEmbedder:
        return self

    def encode(self, texts: Sequence[str]) -> FloatArray:
        vecs = self._model.encode(list(texts), normalize_embeddings=True)
        return np.asarray(vecs, dtype=np.float64)


def build_embedder(
    name: str,
    texts: Sequence[str],
    dim: int = 96,
    sentence_model: str = "all-MiniLM-L6-v2",
    seed: int = 42,
) -> Embedder:
    """Create and fit the configured embedder, degrading to hashing when needed."""
    if name == "sentence-transformers":  # pragma: no cover - optional
        try:
            return SentenceTransformerEmbedder(sentence_model).fit(texts)
        except ImportError:
            name = "lsa"
    if name == "lsa" and len(texts) >= LSAEmbedder.min_docs:
        return LSAEmbedder(dim=dim, seed=seed).fit(texts)
    return HashingEmbedder().fit(texts)


class VectorIndex:
    """Brute-force cosine index (catalogue sizes here are thousands, not millions)."""

    def __init__(self, ids: Sequence[str], vectors: FloatArray) -> None:
        self.ids = list(ids)
        self.index = {pid: i for i, pid in enumerate(self.ids)}
        self.vectors = vectors

    def __len__(self) -> int:
        return len(self.ids)

    def query(
        self, vector: FloatArray, k: int, exclude: set[str] | None = None
    ) -> list[tuple[str, float]]:
        if not self.ids or not np.any(vector):
            return []
        scores = self.vectors @ vector
        order = np.argsort(-scores, kind="stable")
        out: list[tuple[str, float]] = []
        for i in order:
            pid = self.ids[int(i)]
            if exclude and pid in exclude:
                continue
            out.append((pid, float(scores[int(i)])))
            if len(out) >= k:
                break
        return out

    def similar(self, product_id: str, k: int) -> list[tuple[str, float]] | None:
        idx = self.index.get(product_id)
        if idx is None:
            return None
        return self.query(self.vectors[idx], k, exclude={product_id})

from __future__ import annotations

import numpy as np
import pytest

from shopsense_ml.models.embeddings import (
    HashingEmbedder,
    LSAEmbedder,
    VectorIndex,
    build_embedder,
    preprocess,
)

CATALOGUE = [
    "cozy winter fleece jacket warm wool lining",
    "warm wool winter coat cozy and soft",
    "thermal winter parka fleece hood",
    "wireless bluetooth earbuds long battery",
    "bluetooth speaker wireless bass battery",
    "fast usb charger wireless pad",
    "ceramic kettle for tea brewing",
    "steel skillet cookware for kitchen",
    "chef knife steel kitchen sharp",
    "yoga mat grip training fitness",
]


def test_preprocess_lowercases_and_strips() -> None:
    assert preprocess("Cozy, WINTER-coat!") == "cozy winter coat"


def test_lsa_groups_related_products() -> None:
    emb = LSAEmbedder(dim=6).fit(CATALOGUE)
    vecs = emb.encode(CATALOGUE)
    assert vecs.shape == (10, emb.dim)
    assert np.allclose(np.linalg.norm(vecs, axis=1), 1.0)
    index = VectorIndex([str(i) for i in range(10)], vecs)
    q = emb.encode(["cozy winter outfit"])[0]
    top = [pid for pid, _ in index.query(q, 3)]
    assert set(top) <= {"0", "1", "2"}
    assert emb.encode([]).shape == (0, emb.dim)


def test_lsa_requires_fit_and_enough_docs() -> None:
    with pytest.raises(RuntimeError):
        LSAEmbedder().encode(["x"])
    with pytest.raises(ValueError, match="at least"):
        LSAEmbedder().fit(["a", "b"])


def test_hashing_is_stateless_and_normalised() -> None:
    emb = HashingEmbedder(dim=64).fit([])
    a, b = emb.encode(["red running shoe", "red running shoe"])
    assert np.allclose(a, b)
    assert emb.dim == 64
    assert emb.encode([]).shape == (0, 64)


def test_build_embedder_falls_back_for_small_catalogues() -> None:
    assert build_embedder("lsa", CATALOGUE[:3]).name == "hashing"
    assert build_embedder("lsa", CATALOGUE).name == "lsa"
    assert build_embedder("hashing", CATALOGUE).name == "hashing"


def test_vector_index_similar_and_edge_cases() -> None:
    vecs = np.eye(3)
    vecs[1] = [0.8, 0.6, 0.0]
    index = VectorIndex(["a", "b", "c"], vecs)
    sim = index.similar("a", 2)
    assert sim is not None and sim[0][0] == "b"
    assert index.similar("zzz", 2) is None
    assert index.query(np.zeros(3), 2) == []
    assert VectorIndex([], np.zeros((0, 3))).query(np.ones(3), 2) == []
    assert len(index) == 3

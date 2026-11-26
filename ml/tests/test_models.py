from __future__ import annotations

from datetime import timedelta

import numpy as np
import pytest

from shopsense_ml.config import Settings
from shopsense_ml.data.repository import Dataset
from shopsense_ml.evaluation import evaluate, temporal_split
from shopsense_ml.models.als import ALSModel
from shopsense_ml.models.item_knn import ItemKNNModel
from shopsense_ml.models.matrix import InteractionMatrix, top_k
from shopsense_ml.models.popularity import PopularityModel
from shopsense_ml.models.rules import AssociationRules, session_cart_baskets
from shopsense_ml.training import build_content, fit_cf
from tests.conftest import T0, ev, make_product


def test_matrix_sums_weights_and_maps_ids() -> None:
    events = [
        ev("u1", "a"),
        ev("u1", "a", "PURCHASE"),
        ev("u2", "b", "ADD_TO_CART"),
        ev("u3", "zzz"),
    ]
    m = InteractionMatrix.build(events, ["a", "b", "c"])
    assert m.n_users == 2  # unknown product ignored
    assert m.row("u1").tolist() == [6.0, 0.0, 0.0]
    assert m.row("nobody").tolist() == [0.0, 0.0, 0.0]
    assert m.vector_from_items(["b", "nope"]).tolist() == [0.0, 1.0, 0.0]


def test_top_k_respects_exclusions() -> None:
    scores = np.array([0.1, 0.9, 0.5, 0.7])
    assert top_k(scores, 2) == [1, 3]
    assert top_k(scores, 2, np.array([False, True, False, False])) == [3, 2]
    assert top_k(scores, 0) == []


def test_als_loss_decreases_and_reconstructs_observed() -> None:
    rng = np.random.default_rng(0)
    from scipy import sparse

    dense = (rng.random((40, 30)) < 0.2).astype(float) * 3
    model = ALSModel(factors=8, iterations=10, regularization=0.1).fit(sparse.csr_matrix(dense))
    assert model.loss_history[-1] < model.loss_history[0]
    pred = model.user_factors @ model.item_factors.T
    assert pred[dense > 0].mean() > pred[dense == 0].mean() + 0.3


def test_als_and_knn_beat_popularity_on_planted_structure(
    synthetic: Dataset, settings: Settings
) -> None:
    split = temporal_split(synthetic.interactions)
    content = build_content(synthetic.products, settings)
    bundle = fit_cf(split.train, synthetic.products, settings, content, "t")
    n = len(synthetic.products)
    res = {
        s: evaluate(lambda a, k, s=s: bundle.recommend_ids(a, k, s), split.test, 10, n)  # type: ignore[misc]
        for s in ("als", "item_knn", "popularity")
    }
    assert res["als"]["ndcg_at_k"] > 1.5 * res["popularity"]["ndcg_at_k"]
    assert res["item_knn"]["ndcg_at_k"] > 1.5 * res["popularity"]["ndcg_at_k"]
    assert res["als"]["coverage"] > res["popularity"]["coverage"]


def test_als_fold_in_matches_cluster(synthetic: Dataset, settings: Settings) -> None:
    content = build_content(synthetic.products, settings)
    bundle = fit_cf(synthetic.interactions, synthetic.products, settings, content, "t")
    # Items sharing category+style prefix belong to the same planted cluster.
    seed_items = [p.id for p in synthetic.products if p.id.startswith("p00")][:8:4]
    recs = bundle.recommend(None, seed_items, k=5, strategy="als")
    assert not recs.fallback
    ids = [pid for pid, _ in recs.items]
    assert "p00008" in ids  # the remaining member of the planted (category, style) cluster
    assert bundle.als.fold_in(np.zeros(bundle.matrix.n_items)).tolist() == [0.0] * 16
    assert ALSModel().fold_in(np.ones(3)).shape == (32,)


def test_item_knn_neighbours_follow_co_occurrence() -> None:
    events = []
    for u in range(10):
        events += [ev(f"u{u}", "a"), ev(f"u{u}", "b")]
    events += [ev("x", "c"), ev("x", "a")]
    m = InteractionMatrix.build(events, ["a", "b", "c"])
    knn = ItemKNNModel(neighbours=1, shrinkage=1.0).fit(m.matrix)
    neighbours = knn.neighbours_of(m.item_index["b"])
    assert neighbours[0][0] == m.item_index["a"]
    assert len(knn.neighbours_of(m.item_index["a"])) == 1  # pruned to top-1
    assert ItemKNNModel().score_vector(np.ones(2)).tolist() == [0.0, 0.0]


def test_popularity_recency_decay_and_rating_prior() -> None:
    products = [
        make_product("old", "Old"),
        make_product("new", "New"),
        make_product("rated", "Rated", rating_avg=4.9, rating_count=300),
        make_product("cold", "Cold"),
    ]
    events = [
        ev("u1", "old", hours=0),
        ev("u2", "old", hours=1),
        ev("u3", "new", hours=24 * 60),
        ev("u4", "new", hours=24 * 60),
    ]
    pop = PopularityModel(half_life_days=7).fit(events, products)
    ranked = [pid for pid, _ in pop.ranked()]
    assert ranked[0] == "new"
    assert ranked.index("rated") < ranked.index("cold")
    assert [pid for pid, _ in pop.ranked({"cold"})] == ["cold"]
    cold = PopularityModel().fit([], products, now=T0 + timedelta(days=1))
    assert cold.ranked()[0][0] == "rated"


def test_association_rules_hand_computed() -> None:
    baskets = [["a", "b"], ["a", "b"], ["a", "c"], ["b"], ["d"], []]
    rules = AssociationRules(min_support=0.0, min_confidence=0.1, min_count=2).fit(baskets)
    assert rules.n_baskets == 5
    (ab,) = rules.for_item("a", 5)
    assert ab.consequent == "b"
    assert ab.support == pytest.approx(2 / 5)
    assert ab.confidence == pytest.approx(2 / 3)
    assert ab.lift == pytest.approx((2 / 3) / (3 / 5))
    assert rules.for_item("c", 5) == []  # a-c seen once < min_count
    strict = AssociationRules(min_support=0.0, min_confidence=0.9, min_count=1).fit(baskets)
    assert [r.consequent for r in strict.for_item("c", 5)] == ["a"]
    assert AssociationRules().fit([]).rules == {}


def test_session_cart_baskets() -> None:
    events = [
        ev("u", "a", "ADD_TO_CART", session="s1"),
        ev("u", "b", "PURCHASE", session="s1"),
        ev("u", "c", "VIEW", session="s1"),
        ev("v", "a", "ADD_TO_CART", session="s2"),
    ]
    assert session_cart_baskets(events) == [["a", "b"]]

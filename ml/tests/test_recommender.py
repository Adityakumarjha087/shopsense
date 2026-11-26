from __future__ import annotations

import pytest

from shopsense_ml.config import Settings
from shopsense_ml.data.repository import Dataset
from shopsense_ml.models.rules import AssociationRules
from shopsense_ml.recommender import ModelBundle
from shopsense_ml.training import build_content, fit_cf


@pytest.fixture
def bundle(synthetic: Dataset, settings: Settings) -> ModelBundle:
    content = build_content(synthetic.products, settings)
    b = fit_cf(synthetic.interactions, synthetic.products, settings, content, "v1")
    b.rules = AssociationRules(min_support=0.0).fit(x.product_ids for x in synthetic.baskets)
    return b


def test_known_user_gets_personalised_recs_without_seen_items(bundle: ModelBundle) -> None:
    user = "u0001"
    seen = set(bundle.matrix.items[i] for i in bundle.matrix.row(user).nonzero()[0])
    for strategy in ("als", "item_knn"):
        rec = bundle.recommend(user, k=10, strategy=strategy)  # type: ignore[arg-type]
        assert rec.strategy == strategy and not rec.fallback
        ids = [pid for pid, _ in rec.items]
        assert len(ids) == 10 and not (set(ids) & seen)


def test_cold_start_falls_back_to_popularity(bundle: ModelBundle) -> None:
    rec = bundle.recommend("brand-new-user", k=5)
    assert rec.fallback and rec.strategy == "popularity"
    assert [p for p, _ in rec.items] == [p for p, _ in bundle.popular(5)]
    explicit = bundle.recommend("brand-new-user", k=5, strategy="popularity")
    assert not explicit.fallback


def test_exclude_and_recent_fold_in(bundle: ModelBundle) -> None:
    recent = [bundle.matrix.items[0]]
    rec = bundle.recommend(None, recent, k=5, strategy="item_knn", exclude=[bundle.matrix.items[1]])
    ids = [p for p, _ in rec.items]
    assert recent[0] not in ids and bundle.matrix.items[1] not in ids
    assert not rec.fallback
    als = bundle.recommend("u0002", recent, k=5, strategy="als")
    assert len(als.items) == 5


def test_popular_by_category(bundle: ModelBundle) -> None:
    cat = next(iter(bundle.content.category_of.values()))
    items = bundle.popular(5, cat)
    assert items and all(bundle.content.category_of[p] == cat for p, _ in items)


def test_similar_and_semantic_search(bundle: ModelBundle, synthetic: Dataset) -> None:
    pid = synthetic.products[0].id
    sim = bundle.similar(pid, 4)
    assert sim is not None and len(sim) == 4 and pid not in [p for p, _ in sim]
    results = bundle.semantic_search("warm winter jacket", 5)
    assert results
    cats = {bundle.content.category_of[p] for p, _ in results[:3]}
    assert cats == {"cat-0"}  # Outerwear
    assert bundle.semantic_search("qqqqzzzz", 5) == []
    assert bundle.embed(["a b"]).shape[0] == 1


def test_bought_together_sources(bundle: ModelBundle, synthetic: Dataset) -> None:
    antecedent = next(iter(bundle.rules.rules))
    items, source = bundle.bought_together(antecedent, 3)
    assert source == "rules" and items[0]["lift"] > 1  # type: ignore[operator]
    bundle.co_cart = AssociationRules(min_support=0.0).fit([["x1", "x2"], ["x1", "x2"]])
    items, source = bundle.bought_together("x1", 3)
    assert source == "co_cart" and items[0]["product_id"] == "x2"
    assert bundle.bought_together("nothing", 3) == ([], "none")

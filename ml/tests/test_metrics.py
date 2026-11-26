from __future__ import annotations

import math

import pytest

from shopsense_ml.evaluation import (
    evaluate,
    hit_rate_at_k,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    temporal_split,
)
from tests.conftest import ev


def test_precision_recall_hand_computed() -> None:
    recs = ["a", "b", "c", "d"]
    relevant = {"b", "d", "z"}
    assert precision_at_k(recs, relevant, 4) == pytest.approx(0.5)
    assert recall_at_k(recs, relevant, 4) == pytest.approx(2 / 3)
    assert precision_at_k(recs, relevant, 0) == 0.0
    assert recall_at_k(recs, set(), 4) == 0.0


def test_ndcg_hand_computed() -> None:
    recs = ["a", "b", "c"]
    relevant = {"a", "c"}
    dcg = 1 / math.log2(2) + 1 / math.log2(4)
    idcg = 1 / math.log2(2) + 1 / math.log2(3)
    assert ndcg_at_k(recs, relevant, 3) == pytest.approx(dcg / idcg)
    assert ndcg_at_k(["a", "c"], relevant, 3) == pytest.approx(1.0)
    assert ndcg_at_k(recs, set(), 3) == 0.0


def test_hit_rate() -> None:
    assert hit_rate_at_k(["x", "y"], {"y"}, 2) == 1.0
    assert hit_rate_at_k(["x", "y"], {"y"}, 1) == 0.0


def test_temporal_split_holds_out_latest_items_without_leakage() -> None:
    events = [ev("u1", f"p{i}", hours=i) for i in range(10)]
    events += [ev("u1", "p9", "PURCHASE", hours=20)]  # repeat interaction of a held-out item
    events += [ev("u2", "p1", hours=1), ev("u2", "p2", hours=2)]  # too few items
    events += [ev(None, f"p{i}", hours=i, session="anon") for i in range(6)]  # anonymous
    split = temporal_split(events, holdout_fraction=0.2, min_items=5)
    assert split.test == {"u1": {"p8", "p9"}}
    assert all(not (e.actor == "u1" and e.product_id in {"p8", "p9"}) for e in split.train)
    assert len(split.train) == len(events) - 3


def test_evaluate_averages_and_coverage() -> None:
    test = {"u1": {"a"}, "u2": {"b"}}
    recs = {"u1": ["a", "c"], "u2": ["c", "d"]}
    out = evaluate(lambda actor, k: recs[actor][:k], test, k=2, n_items=10)
    assert out["precision_at_k"] == pytest.approx(0.25)
    assert out["recall_at_k"] == pytest.approx(0.5)
    assert out["hit_rate_at_k"] == pytest.approx(0.5)
    assert out["coverage"] == pytest.approx(0.3)
    empty = evaluate(lambda a, k: [], {}, k=2, n_items=10)
    assert empty["precision_at_k"] == 0.0

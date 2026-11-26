"""Training pipeline: fit, evaluate, persist and track all recommendation models."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any

from shopsense_ml.artifacts import save_bundle
from shopsense_ml.config import Settings
from shopsense_ml.data.repository import Dataset, Interaction, Product
from shopsense_ml.evaluation import evaluate, temporal_split
from shopsense_ml.models.als import ALSModel
from shopsense_ml.models.embeddings import build_embedder
from shopsense_ml.models.item_knn import ItemKNNModel
from shopsense_ml.models.matrix import InteractionMatrix
from shopsense_ml.models.popularity import PopularityModel
from shopsense_ml.models.rules import AssociationRules, session_cart_baskets
from shopsense_ml.recommender import (
    STRATEGIES,
    ContentIndex,
    ModelBundle,
    Strategy,
    build_content_index,
    new_version,
)
from shopsense_ml.tracking import NullTracker, Tracker

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class TrainResult:
    bundle: ModelBundle
    run_id: str | None
    artifact: Path | None


def _recommend_ids(bundle: ModelBundle, actor: str, k: int, *, strategy: Strategy) -> list[str]:
    return bundle.recommend_ids(actor, k, strategy)


def fit_cf(
    interactions: list[Interaction],
    products: list[Product],
    settings: Settings,
    content: ContentIndex,
    version: str,
) -> ModelBundle:
    item_ids = [p.id for p in products]
    matrix = InteractionMatrix.build(interactions, item_ids)
    als = ALSModel(
        factors=settings.als_factors,
        regularization=settings.als_regularization,
        alpha=settings.als_alpha,
        iterations=settings.als_iterations,
        seed=settings.seed,
    )
    if matrix.matrix.nnz:
        als.fit(matrix.matrix)
    knn = ItemKNNModel()
    if matrix.matrix.nnz:
        knn.fit(matrix.matrix)
    popularity = PopularityModel(half_life_days=settings.popularity_half_life_days).fit(
        interactions, products
    )
    return ModelBundle(
        version=version,
        trained_at=datetime.now(UTC),
        matrix=matrix,
        als=als,
        knn=knn,
        popularity=popularity,
        rules=AssociationRules(),
        co_cart=AssociationRules(),
        content=content,
    )


def build_content(products: list[Product], settings: Settings) -> ContentIndex:
    embedder = build_embedder(
        settings.embedder,
        [p.text() for p in products],
        dim=settings.embedding_dim,
        sentence_model=settings.sentence_model,
        seed=settings.seed,
    )
    return build_content_index(products, embedder)


def train(
    dataset: Dataset,
    settings: Settings,
    tracker: Tracker | None = None,
    persist: bool = True,
) -> TrainResult:
    started = time.perf_counter()
    tracker = tracker or NullTracker()
    products = dataset.products
    known = {p.id for p in products}
    interactions = [ev for ev in dataset.interactions if ev.product_id in known]
    version = new_version()
    content = build_content(products, settings)
    k = settings.eval_k

    # 1) Offline evaluation on a temporal hold-out.
    split = temporal_split(interactions)
    metrics: dict[str, dict[str, float]] = {}
    if split.test:
        eval_bundle = fit_cf(split.train, products, settings, content, version)
        for strategy in STRATEGIES:
            metrics[strategy] = evaluate(
                partial(_recommend_ids, eval_bundle, strategy=strategy),
                split.test,
                k,
                len(products),
            )

    # 2) Serving models on all data.
    bundle = fit_cf(interactions, products, settings, content, version)
    bundle.rules = AssociationRules(
        min_support=settings.rules_min_support, min_confidence=settings.rules_min_confidence
    ).fit(b.product_ids for b in dataset.baskets)
    bundle.co_cart = AssociationRules(
        min_support=settings.rules_min_support, min_confidence=settings.rules_min_confidence
    ).fit(session_cart_baskets(interactions))

    params: dict[str, Any] = {
        "als_factors": settings.als_factors,
        "als_regularization": settings.als_regularization,
        "als_alpha": settings.als_alpha,
        "als_iterations": settings.als_iterations,
        "knn_neighbours": bundle.knn.neighbours,
        "knn_shrinkage": bundle.knn.shrinkage,
        "popularity_half_life_days": settings.popularity_half_life_days,
        "rules_min_support": settings.rules_min_support,
        "rules_min_confidence": settings.rules_min_confidence,
        "embedder": content.embedder.name,
        "embedding_dim": content.embedder.dim,
        "eval_k": k,
    }
    stats = {
        "n_products": len(products),
        "n_users": bundle.matrix.n_users,
        "n_interactions": len(interactions),
        "n_nonzero": int(bundle.matrix.matrix.nnz),
        "n_baskets": bundle.rules.n_baskets,
        "n_rules": sum(len(v) for v in bundle.rules.rules.values()),
        "n_co_cart_rules": sum(len(v) for v in bundle.co_cart.rules.values()),
        "n_eval_users": len(split.test),
    }
    duration = time.perf_counter() - started
    bundle.metadata = {
        "version": version,
        "trained_at": bundle.trained_at.isoformat(),
        "params": params,
        "dataset": stats,
        "metrics": metrics,
        "als_loss": bundle.als.loss_history[-1] if bundle.als.loss_history else None,
        "train_seconds": round(duration, 3),
        "embedder": content.embedder.name,
        "mlflow_run_id": None,
    }

    artifact: Path | None = None
    artifacts: list[Path] = []
    if persist:
        artifact, meta_path = save_bundle(bundle, settings.model_dir)
        artifacts = [meta_path]
    flat = {f"{s}_{name}": v for s, vals in metrics.items() for name, v in vals.items()}
    flat.update({f"dataset_{key}": float(v) for key, v in stats.items()})
    flat["train_seconds"] = duration
    run_id = tracker.log_run(
        run_name=f"train-{version}",
        params=params,
        metrics=flat,
        artifacts=artifacts,
        tags={"model_version": version, "embedder": content.embedder.name},
    )
    bundle.metadata["mlflow_run_id"] = run_id
    if persist and run_id:
        save_bundle(bundle, settings.model_dir)
    log.info(
        "training finished",
        extra={"version": version, "seconds": round(duration, 2), "metrics": metrics, **stats},
    )
    return TrainResult(bundle=bundle, run_id=run_id, artifact=artifact)

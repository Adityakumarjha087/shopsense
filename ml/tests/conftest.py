from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from shopsense_ml.config import Settings
from shopsense_ml.data.repository import Dataset, Interaction, Product
from shopsense_ml.data.synthetic import SyntheticConfig, generate

T0 = datetime(2026, 3, 1, tzinfo=UTC)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=None,
        model_dir=tmp_path / "artifacts",
        mlflow_tracking_uri=None,
        als_iterations=8,
        als_factors=16,
        train_cron="off",
        log_json=False,
    )


@pytest.fixture(scope="session")
def synthetic() -> Dataset:
    return generate(SyntheticConfig(n_products_per_category=12, n_users=120, seed=3))


def make_product(
    pid: str,
    name: str,
    category: str = "Outerwear",
    description: str | None = None,
    rating_avg: float = 0.0,
    rating_count: int = 0,
    tags: tuple[str, ...] = (),
) -> Product:
    return Product(
        id=pid,
        name=name,
        description=description or name,
        brand="Acme",
        category_id=f"cat-{category}",
        category=category,
        base_price=1000,
        tags=tags,
        rating_avg=rating_avg,
        rating_count=rating_count,
    )


def ev(
    user: str | None, pid: str, etype: str = "VIEW", hours: float = 0.0, session: str | None = None
) -> Interaction:
    return Interaction(user, session or f"s-{user}", etype, pid, T0 + timedelta(hours=hours))

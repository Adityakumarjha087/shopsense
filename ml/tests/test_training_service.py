from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from shopsense_ml.artifacts import load_current, save_bundle
from shopsense_ml.config import Settings
from shopsense_ml.data.memory import InMemoryRepository
from shopsense_ml.data.repository import Dataset
from shopsense_ml.service import ModelService, default_repository
from shopsense_ml.tracking import MLflowTracker, NullTracker
from shopsense_ml.training import train


class RecordingTracker:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def log_run(
        self,
        run_name: str,
        params: dict[str, Any],
        metrics: dict[str, float],
        artifacts: list[Path],
        tags: dict[str, str],
    ) -> str | None:
        self.calls.append({"params": params, "metrics": metrics, "artifacts": artifacts})
        return "run-123"


def test_train_persists_tracks_and_reports_metrics(synthetic: Dataset, settings: Settings) -> None:
    tracker = RecordingTracker()
    result = train(synthetic, settings, tracker)
    meta = result.bundle.metadata
    assert set(meta["metrics"]) == {"als", "item_knn", "popularity"}
    assert meta["metrics"]["als"]["ndcg_at_k"] > meta["metrics"]["popularity"]["ndcg_at_k"]
    assert meta["mlflow_run_id"] == "run-123"
    assert meta["dataset"]["n_rules"] > 0
    assert tracker.calls[0]["metrics"]["als_precision_at_k"] > 0
    assert result.artifact is not None and result.artifact.exists()
    loaded = load_current(settings.model_dir)
    assert loaded is not None and loaded.version == result.bundle.version
    assert loaded.metadata["mlflow_run_id"] == "run-123"


def test_artifact_pruning_and_corrupt_pointer(synthetic: Dataset, settings: Settings) -> None:
    bundle = train(synthetic, settings, NullTracker()).bundle
    for i in range(4):
        bundle.version = f"v{i}"
        save_bundle(bundle, settings.model_dir)
    assert len(list(settings.model_dir.glob("model-*.pkl"))) == 3
    (settings.model_dir / "current.json").write_text(json.dumps({"model": "missing.pkl"}))
    assert load_current(settings.model_dir) is None
    assert load_current(settings.model_dir / "nope") is None


def test_mlflow_tracker_logs_to_local_file_store(
    synthetic: Dataset, settings: Settings, tmp_path: Path
) -> None:
    tracker = MLflowTracker(None, "test-exp", tmp_path)
    run_id = train(synthetic, settings, tracker).run_id
    assert run_id
    assert (tmp_path / "mlruns").exists()


def test_mlflow_tracker_failure_is_swallowed(tmp_path: Path) -> None:
    tracker = MLflowTracker("http://127.0.0.1:9", "x", tmp_path)
    assert tracker.log_run("r", {}, {"m": 1.0}, [], {}) is None


def test_service_startup_trains_then_reloads(synthetic: Dataset, settings: Settings) -> None:
    svc = ModelService(settings, lambda: InMemoryRepository(synthetic), NullTracker())
    assert not svc.is_trained
    assert svc.bundle.version == "untrained"
    svc.startup()
    assert svc.is_trained
    version = svc.bundle.version
    again = ModelService(settings, lambda: InMemoryRepository(Dataset()), NullTracker())
    again.startup()
    assert again.bundle.version == version


def test_service_startup_handles_missing_data(settings: Settings) -> None:
    def boom() -> InMemoryRepository:
        raise ConnectionError("db down")

    svc = ModelService(settings, boom, NullTracker())
    svc.startup()
    assert svc.last_error == "db down" and not svc.is_trained
    empty = ModelService(settings, lambda: InMemoryRepository(), NullTracker())
    empty.startup()
    assert not empty.is_trained
    lazy = ModelService(
        settings.model_copy(update={"train_on_startup": False}),
        lambda: InMemoryRepository(),
        NullTracker(),
    )
    lazy.startup()
    assert not lazy.is_trained


def test_refresh_index_reembeds_catalogue(synthetic: Dataset, settings: Settings) -> None:
    repo = InMemoryRepository(synthetic)
    svc = ModelService(settings, lambda: repo, NullTracker())
    svc.train()
    repo.dataset = Dataset(products=synthetic.products[:20], interactions=synthetic.interactions)
    bundle = svc.refresh_index()
    assert len(bundle.content.index) == 20
    assert bundle.metadata["n_indexed_products"] == 20


def test_default_repository_selection(settings: Settings) -> None:
    from shopsense_ml.data.postgres import PostgresRepository

    assert isinstance(default_repository(settings), InMemoryRepository)
    pg = settings.model_copy(update={"database_url": "postgresql://x@localhost/db"})
    assert isinstance(default_repository(pg), PostgresRepository)


def test_cli_synthetic_and_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    from shopsense_ml import config
    from shopsense_ml import train as cli

    monkeypatch.setenv("MODEL_DIR", str(tmp_path / "m"))
    monkeypatch.setenv("ALS_ITERATIONS", "3")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    config.get_settings.cache_clear()
    try:
        assert cli.main(["--synthetic", "--no-mlflow"]) == 0
        out = json.loads(capsys.readouterr().out)
        assert "als" in out["metrics"]
        assert cli.main(["--no-mlflow"]) == 1
    finally:
        config.get_settings.cache_clear()

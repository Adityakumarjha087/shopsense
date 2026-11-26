"""Holds the active model bundle and coordinates (re)training and hot-swapping."""

from __future__ import annotations

import dataclasses
import logging
import threading
from collections.abc import Callable

from shopsense_ml.artifacts import load_current, save_bundle
from shopsense_ml.config import Settings
from shopsense_ml.data.memory import InMemoryRepository
from shopsense_ml.data.repository import Dataset, Repository, load_dataset
from shopsense_ml.recommender import ModelBundle
from shopsense_ml.tracking import MLflowTracker, Tracker
from shopsense_ml.training import build_content, fit_cf, train

log = logging.getLogger(__name__)


def default_repository(settings: Settings) -> Repository:
    if settings.database_url:
        from shopsense_ml.data.postgres import PostgresRepository

        return PostgresRepository(settings.database_url)
    return InMemoryRepository()


class ModelService:
    def __init__(
        self,
        settings: Settings,
        repository_factory: Callable[[], Repository] | None = None,
        tracker: Tracker | None = None,
    ) -> None:
        self.settings = settings
        self._repo_factory = repository_factory or (lambda: default_repository(settings))
        self.tracker: Tracker = tracker or MLflowTracker(
            settings.mlflow_tracking_uri, settings.mlflow_experiment, settings.model_dir
        )
        self._lock = threading.Lock()
        self._train_lock = threading.Lock()
        self._bundle: ModelBundle | None = None
        self.last_error: str | None = None

    @property
    def bundle(self) -> ModelBundle:
        with self._lock:
            if self._bundle is None:
                self._bundle = self._empty_bundle()
            return self._bundle

    @property
    def is_trained(self) -> bool:
        return self._bundle is not None and bool(self._bundle.metadata)

    def _swap(self, bundle: ModelBundle) -> None:
        with self._lock:
            self._bundle = bundle

    def _empty_bundle(self) -> ModelBundle:
        content = build_content([], self.settings)
        return fit_cf([], [], self.settings, content, version="untrained")

    def startup(self) -> None:
        """Load persisted artefacts, else train when data exists. Never raises."""
        loaded = load_current(self.settings.model_dir)
        if loaded is not None:
            self._swap(loaded)
            log.info("loaded model artefact", extra={"version": loaded.version})
            return
        if not self.settings.train_on_startup:
            return
        try:
            dataset = load_dataset(self._repo_factory())
        except Exception as exc:
            self.last_error = str(exc)
            log.warning("data source unavailable at startup", extra={"error": str(exc)})
            return
        if dataset.products:
            self.train(dataset)

    def train(self, dataset: Dataset | None = None) -> ModelBundle:
        with self._train_lock:
            data = dataset if dataset is not None else load_dataset(self._repo_factory())
            result = train(data, self.settings, self.tracker)
            self._swap(result.bundle)
            self.last_error = None
            return result.bundle

    def refresh_index(self) -> ModelBundle:
        """Re-embed the current catalogue without retraining CF models."""
        with self._train_lock:
            products = self._repo_factory().products()
            content = build_content(products, self.settings)
            current = self.bundle
            updated = dataclasses.replace(current, content=content)
            updated.metadata = {
                **current.metadata,
                "embedder": content.embedder.name,
                "n_indexed_products": len(products),
            }
            if current.metadata:
                save_bundle(updated, self.settings.model_dir)
            self._swap(updated)
            return updated

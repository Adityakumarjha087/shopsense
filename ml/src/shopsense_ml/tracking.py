"""MLflow experiment tracking that never takes the service down."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Protocol

log = logging.getLogger(__name__)


class Tracker(Protocol):
    def log_run(
        self,
        run_name: str,
        params: dict[str, Any],
        metrics: dict[str, float],
        artifacts: list[Path],
        tags: dict[str, str],
    ) -> str | None: ...


class NullTracker:
    def log_run(
        self,
        run_name: str,
        params: dict[str, Any],
        metrics: dict[str, float],
        artifacts: list[Path],
        tags: dict[str, str],
    ) -> str | None:
        return None


class MLflowTracker:
    def __init__(self, tracking_uri: str | None, experiment: str, fallback_dir: Path) -> None:
        self.tracking_uri = tracking_uri or (fallback_dir / "mlruns").resolve().as_uri()
        self.experiment = experiment
        # Fail fast instead of retrying for minutes when the server is down.
        os.environ.setdefault("MLFLOW_HTTP_REQUEST_MAX_RETRIES", "0")
        os.environ.setdefault("MLFLOW_HTTP_REQUEST_TIMEOUT", "10")

    def log_run(
        self,
        run_name: str,
        params: dict[str, Any],
        metrics: dict[str, float],
        artifacts: list[Path],
        tags: dict[str, str],
    ) -> str | None:
        try:
            import mlflow

            mlflow.set_tracking_uri(self.tracking_uri)
            mlflow.set_experiment(self.experiment)
            with mlflow.start_run(run_name=run_name) as run:
                mlflow.set_tags(tags)
                mlflow.log_params({k: str(v) for k, v in params.items()})
                mlflow.log_metrics(metrics)
                for path in artifacts:
                    mlflow.log_artifact(str(path))
                run_id: str = run.info.run_id
            log.info("mlflow run logged", extra={"run_id": run_id, "uri": self.tracking_uri})
            return run_id
        except Exception as exc:  # MLflow is optional; training must still succeed.
            log.warning("mlflow logging failed", extra={"error": str(exc)})
            return None

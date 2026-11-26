"""CLI: ``python -m shopsense_ml.train [--synthetic] [--no-mlflow]``."""

from __future__ import annotations

import argparse
import json
import sys

from shopsense_ml.config import get_settings
from shopsense_ml.data.repository import load_dataset
from shopsense_ml.data.synthetic import generate
from shopsense_ml.logging_setup import configure_logging
from shopsense_ml.service import default_repository
from shopsense_ml.tracking import MLflowTracker, NullTracker, Tracker
from shopsense_ml.training import train


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train ShopSense recommendation models")
    parser.add_argument("--synthetic", action="store_true", help="train on generated data")
    parser.add_argument("--no-mlflow", action="store_true", help="skip MLflow logging")
    args = parser.parse_args(argv)
    settings = get_settings()
    configure_logging(settings.log_level, json_output=False, stream=sys.stderr)
    dataset = generate() if args.synthetic else load_dataset(default_repository(settings))
    if not dataset.products:
        print("no products found; seed the database or pass --synthetic", file=sys.stderr)
        return 1
    tracker: Tracker = (
        NullTracker()
        if args.no_mlflow
        else MLflowTracker(
            settings.mlflow_tracking_uri, settings.mlflow_experiment, settings.model_dir
        )
    )
    result = train(dataset, settings, tracker)
    print(
        json.dumps(
            {
                "version": result.bundle.version,
                "mlflow_run_id": result.run_id,
                "metrics": result.bundle.metadata["metrics"],
                "dataset": result.bundle.metadata["dataset"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

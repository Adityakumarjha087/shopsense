from __future__ import annotations

import json
import logging

import pytest

from shopsense_ml.config import Settings
from shopsense_ml.data.memory import InMemoryRepository
from shopsense_ml.data.repository import EVENT_WEIGHTS, Dataset
from shopsense_ml.logging_setup import JsonFormatter, configure_logging
from shopsense_ml.scheduler import BOOTSTRAP_JOB, _bootstrap, _job, start_scheduler
from shopsense_ml.service import ModelService
from shopsense_ml.tracking import NullTracker
from tests.conftest import ev


def test_json_formatter_includes_extras() -> None:
    record = logging.LogRecord("x", logging.INFO, __file__, 1, "hello %s", ("w",), None)
    record.version = "v1"
    out = json.loads(JsonFormatter().format(record))
    assert out["msg"] == "hello w" and out["version"] == "v1" and out["level"] == "info"
    try:
        raise ValueError("bad")
    except ValueError:
        import sys

        err = logging.LogRecord("x", logging.ERROR, __file__, 1, "e", (), sys.exc_info())
    assert "ValueError" in json.loads(JsonFormatter().format(err))["exc"]
    configure_logging("DEBUG", json_output=False)
    configure_logging("INFO", json_output=True)


def test_scheduler_disabled_and_enabled(settings: Settings, synthetic: Dataset) -> None:
    svc = ModelService(settings, lambda: InMemoryRepository(), NullTracker())
    assert start_scheduler(svc, "off", bootstrap_seconds=0) is None
    sched = start_scheduler(svc, "0 2 * * *")
    assert sched is not None
    assert sched.get_job("nightly-retrain") is not None
    assert sched.get_job(BOOTSTRAP_JOB) is not None  # untrained -> retry until data exists
    sched.shutdown(wait=False)
    only_bootstrap = start_scheduler(svc, "off")
    assert only_bootstrap is not None
    assert only_bootstrap.get_job("nightly-retrain") is None
    only_bootstrap.shutdown(wait=False)


def test_bootstrap_job_trains_once_data_appears(settings: Settings, synthetic: Dataset) -> None:
    repo = InMemoryRepository()
    svc = ModelService(settings, lambda: repo, NullTracker())
    sched = start_scheduler(svc, "off", bootstrap_seconds=3600)
    assert sched is not None
    _bootstrap(svc, sched)
    assert not svc.is_trained
    assert sched.get_job(BOOTSTRAP_JOB) is not None
    repo.dataset = synthetic
    _bootstrap(svc, sched)
    assert svc.is_trained
    assert sched.get_job(BOOTSTRAP_JOB) is None
    sched.shutdown(wait=False)


def test_scheduled_job_records_errors(settings: Settings) -> None:
    svc = ModelService(settings, lambda: InMemoryRepository(), NullTracker())
    _job(svc)  # empty data -> trains an empty model without raising

    def boom() -> InMemoryRepository:
        raise RuntimeError("db gone")

    broken = ModelService(settings, boom, NullTracker())
    _job(broken)
    assert broken.last_error == "db gone"


def test_interaction_weights_and_actor() -> None:
    assert EVENT_WEIGHTS["PURCHASE"] > EVENT_WEIGHTS["ADD_TO_CART"] > EVENT_WEIGHTS["VIEW"]
    assert ev(None, "p", session="abc").actor == "session:abc"
    assert ev("u", "p", "UNKNOWN").weight == pytest.approx(1.0)

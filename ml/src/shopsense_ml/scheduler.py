"""Nightly retraining via APScheduler (cron expression in TRAIN_CRON)."""

from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from shopsense_ml.service import ModelService

log = logging.getLogger(__name__)


def _job(service: ModelService) -> None:
    try:
        bundle = service.train()
        log.info("scheduled retrain complete", extra={"version": bundle.version})
    except Exception as exc:
        service.last_error = str(exc)
        log.exception("scheduled retrain failed")


def _bootstrap(service: ModelService, scheduler: BackgroundScheduler) -> None:
    """Train as soon as data appears (e.g. the DB was seeded after the service started)."""
    if service.is_trained:
        scheduler.remove_job(BOOTSTRAP_JOB)
        return
    service.startup()
    if service.is_trained:
        log.info("bootstrap training complete", extra={"version": service.bundle.version})
        scheduler.remove_job(BOOTSTRAP_JOB)


BOOTSTRAP_JOB = "bootstrap-train"


def start_scheduler(
    service: ModelService, cron: str, bootstrap_seconds: float = 30.0
) -> BackgroundScheduler | None:
    disabled = not cron or cron.strip().lower() in {"off", "none", "disabled"}
    if disabled and (service.is_trained or bootstrap_seconds <= 0):
        log.info("nightly retraining disabled")
        return None
    scheduler = BackgroundScheduler(timezone="UTC")
    if not service.is_trained and bootstrap_seconds > 0:
        scheduler.add_job(
            _bootstrap,
            IntervalTrigger(seconds=bootstrap_seconds),
            args=[service, scheduler],
            id=BOOTSTRAP_JOB,
            max_instances=1,
            coalesce=True,
            replace_existing=True,
        )
    if disabled:
        log.info("nightly retraining disabled")
        scheduler.start()
        return scheduler
    scheduler.add_job(
        _job,
        CronTrigger.from_crontab(cron, timezone="UTC"),
        args=[service],
        id="nightly-retrain",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    scheduler.start()
    log.info("nightly retraining scheduled", extra={"cron": cron})
    return scheduler

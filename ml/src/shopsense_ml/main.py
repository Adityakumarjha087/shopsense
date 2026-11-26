"""ASGI entrypoint: ``uvicorn shopsense_ml.main:app``."""

from __future__ import annotations

from shopsense_ml.api import create_app
from shopsense_ml.config import get_settings
from shopsense_ml.logging_setup import configure_logging

_settings = get_settings()
configure_logging(_settings.log_level, _settings.log_json)
app = create_app(settings=_settings)

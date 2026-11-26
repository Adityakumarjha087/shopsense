"""Runtime configuration (environment variables, see ml/.env.example)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

EmbedderName = Literal["lsa", "hashing", "sentence-transformers"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str | None = Field(default=None, description="Postgres DSN (read-only use)")
    model_dir: Path = Path("./artifacts")
    mlflow_tracking_uri: str | None = None
    mlflow_experiment: str = "shopsense-recommender"
    embedder: EmbedderName = "lsa"
    embedding_dim: int = 96
    sentence_model: str = "all-MiniLM-L6-v2"
    train_cron: str = "0 2 * * *"
    train_on_startup: bool = True
    bootstrap_retry_seconds: float = 30.0
    eval_k: int = 10
    als_factors: int = 32
    als_regularization: float = 0.05
    als_alpha: float = 20.0
    als_iterations: int = 15
    popularity_half_life_days: float = 14.0
    rules_min_support: float = 0.002
    rules_min_confidence: float = 0.05
    log_level: str = "INFO"
    log_json: bool = True
    seed: int = 42


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

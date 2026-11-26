"""FastAPI application exposing the ML service contract (docs/ML_SERVICE_CONTRACT.md)."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from shopsense_ml import __version__
from shopsense_ml.config import Settings, get_settings
from shopsense_ml.recommender import Strategy
from shopsense_ml.scheduler import start_scheduler
from shopsense_ml.service import ModelService

log = logging.getLogger(__name__)


class ScoredItem(BaseModel):
    product_id: str
    score: float


class RecommendResponse(BaseModel):
    items: list[ScoredItem]
    strategy: str
    fallback: bool
    model_version: str


class ItemsResponse(BaseModel):
    items: list[ScoredItem]


class BoughtTogetherItem(BaseModel):
    product_id: str
    support: float
    confidence: float
    lift: float


class BoughtTogetherResponse(BaseModel):
    items: list[BoughtTogetherItem]
    source: str


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=256)


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    dim: int
    embedder: str


class SemanticSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    k: int = Field(default=50, ge=1, le=500)


class SemanticSearchResponse(BaseModel):
    items: list[ScoredItem]
    embedder: str


class HealthResponse(BaseModel):
    status: str
    service_version: str
    model_version: str
    trained_at: str | None
    embedder: str
    n_products: int
    last_error: str | None


def _csv(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _model_info(service: ModelService) -> dict[str, Any]:
    bundle = service.bundle
    meta = dict(bundle.metadata)
    meta.setdefault("version", bundle.version)
    meta.setdefault("trained_at", None)
    meta.setdefault("metrics", {})
    meta.setdefault("params", {})
    meta.setdefault("dataset", {})
    return meta


def create_app(
    service: ModelService | None = None,
    settings: Settings | None = None,
    start_background: bool = True,
) -> FastAPI:
    cfg = settings or get_settings()
    svc = service or ModelService(cfg)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        scheduler = None
        if start_background:
            await run_in_threadpool(svc.startup)
            scheduler = start_scheduler(svc, cfg.train_cron, cfg.bootstrap_retry_seconds)
        yield
        if scheduler is not None:
            scheduler.shutdown(wait=False)

    app = FastAPI(title="ShopSense ML service", version=__version__, lifespan=lifespan)
    app.state.service = svc

    @app.middleware("http")
    async def access_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        if request.url.path != "/health":
            log.info(
                "request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "ms": round((time.perf_counter() - start) * 1000, 1),
                },
            )
        return response

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        bundle = svc.bundle
        return HealthResponse(
            status="ok",
            service_version=__version__,
            model_version=bundle.version,
            trained_at=bundle.metadata.get("trained_at"),
            embedder=bundle.content.embedder.name,
            n_products=len(bundle.content.index),
            last_error=svc.last_error,
        )

    @app.get("/models/current")
    def current_model() -> dict[str, Any]:
        return _model_info(svc)

    @app.post("/train")
    async def train_now() -> dict[str, Any]:
        try:
            await run_in_threadpool(svc.train)
        except Exception as exc:
            log.exception("training failed")
            raise HTTPException(status_code=503, detail=f"training failed: {exc}") from exc
        return _model_info(svc)

    @app.post("/index/refresh")
    async def refresh_index() -> dict[str, Any]:
        try:
            bundle = await run_in_threadpool(svc.refresh_index)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"refresh failed: {exc}") from exc
        return {"n_products": len(bundle.content.index), "embedder": bundle.content.embedder.name}

    @app.get("/recommend/user", response_model=RecommendResponse)
    def recommend_user(
        user_id: str | None = None,
        recent: str | None = None,
        k: Annotated[int, Query(ge=1, le=100)] = 10,
        strategy: Strategy = "als",
        exclude: str | None = None,
    ) -> RecommendResponse:
        bundle = svc.bundle
        rec = bundle.recommend(user_id or None, _csv(recent), k, strategy, _csv(exclude))
        return RecommendResponse(
            items=[ScoredItem(product_id=p, score=s) for p, s in rec.items],
            strategy=rec.strategy,
            fallback=rec.fallback,
            model_version=bundle.version,
        )

    @app.get("/similar/{product_id}", response_model=ItemsResponse)
    def similar(product_id: str, k: Annotated[int, Query(ge=1, le=100)] = 8) -> ItemsResponse:
        found = svc.bundle.similar(product_id, k)
        if found is None:
            raise HTTPException(status_code=404, detail="unknown product")
        return ItemsResponse(items=[ScoredItem(product_id=p, score=s) for p, s in found])

    @app.get("/bought-together/{product_id}", response_model=BoughtTogetherResponse)
    def bought_together(
        product_id: str, k: Annotated[int, Query(ge=1, le=50)] = 4
    ) -> BoughtTogetherResponse:
        items, source = svc.bundle.bought_together(product_id, k)
        return BoughtTogetherResponse(
            items=[BoughtTogetherItem.model_validate(i) for i in items], source=source
        )

    @app.get("/popular", response_model=ItemsResponse)
    def popular(
        k: Annotated[int, Query(ge=1, le=200)] = 10, category_id: str | None = None
    ) -> ItemsResponse:
        found = svc.bundle.popular(k, category_id)
        return ItemsResponse(items=[ScoredItem(product_id=p, score=s) for p, s in found])

    @app.post("/embed", response_model=EmbedResponse)
    def embed(body: EmbedRequest) -> EmbedResponse:
        bundle = svc.bundle
        vectors = bundle.embed(body.texts)
        return EmbedResponse(
            vectors=vectors.tolist(),
            dim=int(vectors.shape[1]) if vectors.ndim == 2 else 0,
            embedder=bundle.content.embedder.name,
        )

    @app.post("/search/semantic", response_model=SemanticSearchResponse)
    def semantic_search(body: SemanticSearchRequest) -> SemanticSearchResponse:
        bundle = svc.bundle
        found = bundle.semantic_search(body.query, body.k)
        return SemanticSearchResponse(
            items=[ScoredItem(product_id=p, score=s) for p, s in found],
            embedder=bundle.content.embedder.name,
        )

    return app

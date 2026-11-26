from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from shopsense_ml.api import create_app
from shopsense_ml.config import Settings
from shopsense_ml.data.memory import InMemoryRepository
from shopsense_ml.data.repository import Dataset
from shopsense_ml.service import ModelService
from shopsense_ml.tracking import NullTracker


@pytest.fixture
def client(synthetic: Dataset, settings: Settings) -> Iterator[TestClient]:
    svc = ModelService(settings, lambda: InMemoryRepository(synthetic), NullTracker())
    app = create_app(svc, settings, start_background=True)
    with TestClient(app) as c:
        yield c


def test_health_and_model_info(client: TestClient) -> None:
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["embedder"] == "lsa" and body["n_products"] == 72
    model = client.get("/models/current").json()
    assert model["version"] == body["model_version"]
    assert "als" in model["metrics"]


def test_recommend_endpoints(client: TestClient, synthetic: Dataset) -> None:
    r = client.get("/recommend/user", params={"user_id": "u0001", "k": 5}).json()
    assert len(r["items"]) == 5 and r["strategy"] == "als" and r["fallback"] is False
    cold = client.get("/recommend/user", params={"k": 3}).json()
    assert cold["fallback"] is True and len(cold["items"]) == 3
    pid = synthetic.products[0].id
    recent = client.get(
        "/recommend/user",
        params={"recent": pid, "strategy": "item_knn", "exclude": synthetic.products[1].id},
    ).json()
    assert recent["strategy"] == "item_knn"
    assert pid not in [i["product_id"] for i in recent["items"]]
    assert client.get("/recommend/user", params={"strategy": "bogus"}).status_code == 422


def test_similar_popular_bought_together(client: TestClient, synthetic: Dataset) -> None:
    pid = synthetic.products[0].id
    assert len(client.get(f"/similar/{pid}", params={"k": 3}).json()["items"]) == 3
    assert client.get("/similar/missing").status_code == 404
    assert len(client.get("/popular", params={"k": 4}).json()["items"]) == 4
    cat = client.get("/popular", params={"k": 4, "category_id": "cat-1"}).json()["items"]
    assert cat
    bt = client.get(f"/bought-together/{pid}").json()
    assert bt["source"] in {"rules", "co_cart", "none"}


def test_embed_and_semantic_search(client: TestClient) -> None:
    body = client.post("/embed", json={"texts": ["warm jacket", "earbuds"]}).json()
    assert len(body["vectors"]) == 2 and body["dim"] == len(body["vectors"][0])
    assert client.post("/embed", json={"texts": []}).status_code == 422
    res = client.post("/search/semantic", json={"query": "cozy winter coat", "k": 5}).json()
    assert res["items"] and res["embedder"] == "lsa"


def test_train_and_refresh(client: TestClient) -> None:
    before = client.get("/health").json()["model_version"]
    after = client.post("/train").json()
    assert after["version"] != before
    assert client.post("/index/refresh").json()["n_products"] == 72


def test_train_failure_returns_503(settings: Settings) -> None:
    def broken() -> InMemoryRepository:
        raise ConnectionError("down")

    svc = ModelService(settings, broken, NullTracker())
    with TestClient(create_app(svc, settings, start_background=False)) as c:
        assert c.post("/train").status_code == 503
        assert c.post("/index/refresh").status_code == 503
        health = c.get("/health").json()
        assert health["model_version"] == "untrained"
        assert c.get("/recommend/user").json()["items"] == []

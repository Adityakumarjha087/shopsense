"""Domain records and the repository protocol the training job depends on."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

EVENT_WEIGHTS: dict[str, float] = {
    "VIEW": 1.0,
    "WISHLIST": 2.0,
    "ADD_TO_CART": 3.0,
    "PURCHASE": 5.0,
}


@dataclass(frozen=True, slots=True)
class Product:
    id: str
    name: str
    description: str
    brand: str
    category_id: str
    category: str
    base_price: int
    tags: tuple[str, ...] = ()
    rating_avg: float = 0.0
    rating_count: int = 0
    created_at: datetime | None = None

    def text(self) -> str:
        """Text used for content embeddings."""
        return " ".join(
            [self.name, self.brand, self.category, " ".join(self.tags), self.description]
        )


@dataclass(frozen=True, slots=True)
class Interaction:
    user_id: str | None
    session_id: str
    type: str
    product_id: str
    created_at: datetime

    @property
    def weight(self) -> float:
        return EVENT_WEIGHTS.get(self.type, 1.0)

    @property
    def actor(self) -> str:
        """Stable identity for CF: the user when known, otherwise the session."""
        return self.user_id or f"session:{self.session_id}"


@dataclass(frozen=True, slots=True)
class Basket:
    order_id: str
    product_ids: tuple[str, ...]
    created_at: datetime | None = None


@dataclass(slots=True)
class Dataset:
    products: list[Product] = field(default_factory=list)
    interactions: list[Interaction] = field(default_factory=list)
    baskets: list[Basket] = field(default_factory=list)


class Repository(Protocol):
    def products(self) -> list[Product]: ...

    def interactions(self) -> list[Interaction]: ...

    def baskets(self) -> list[Basket]: ...


def load_dataset(repo: Repository) -> Dataset:
    return Dataset(
        products=repo.products(), interactions=repo.interactions(), baskets=repo.baskets()
    )

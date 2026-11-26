"""In-memory repository (tests, synthetic training)."""

from __future__ import annotations

from shopsense_ml.data.repository import Basket, Dataset, Interaction, Product


class InMemoryRepository:
    def __init__(self, dataset: Dataset | None = None) -> None:
        self.dataset = dataset or Dataset()

    def products(self) -> list[Product]:
        return list(self.dataset.products)

    def interactions(self) -> list[Interaction]:
        return list(self.dataset.interactions)

    def baskets(self) -> list[Basket]:
        return list(self.dataset.baskets)

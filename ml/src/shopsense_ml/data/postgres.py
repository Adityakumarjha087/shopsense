"""Read-only Postgres repository over the Prisma-managed tables."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

import psycopg

from shopsense_ml.data.repository import Basket, Interaction, Product

PRODUCTS_SQL = """
SELECT p.id, p.name, p.description, p.brand, p.category_id, c.name AS category,
       p.base_price, p.tags, p.rating_avg, p.rating_count, p.created_at
FROM products p JOIN categories c ON c.id = p.category_id
WHERE p.is_active = TRUE
ORDER BY p.id
"""

EVENTS_SQL = """
SELECT user_id, session_id, type::text, product_id, created_at
FROM events
ORDER BY created_at, id
"""

BASKETS_SQL = """
SELECT o.id, oi.product_id, o.created_at
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.status::text IN ('PAID', 'SHIPPED', 'DELIVERED')
ORDER BY o.created_at, o.id
"""


class PostgresRepository:
    def __init__(self, dsn: str, schema: str | None = None) -> None:
        self._dsn = dsn
        self._schema = schema

    def _connect(self) -> psycopg.Connection[tuple[object, ...]]:
        conn = psycopg.connect(self._dsn, autocommit=True, connect_timeout=5)
        if self._schema:
            conn.execute(f'SET search_path TO "{self._schema}"')
        return conn

    def products(self) -> list[Product]:
        with self._connect() as conn:
            rows = conn.execute(PRODUCTS_SQL).fetchall()
        return [
            Product(
                id=str(r[0]),
                name=str(r[1]),
                description=str(r[2]),
                brand=str(r[3]),
                category_id=str(r[4]),
                category=str(r[5]),
                base_price=int(r[6]),  # type: ignore[call-overload]
                tags=tuple(r[7] or ()),  # type: ignore[arg-type]
                rating_avg=float(r[8]),  # type: ignore[arg-type]
                rating_count=int(r[9]),  # type: ignore[call-overload]
                created_at=r[10] if isinstance(r[10], datetime) else None,
            )
            for r in rows
        ]

    def interactions(self) -> list[Interaction]:
        with self._connect() as conn:
            rows = conn.execute(EVENTS_SQL).fetchall()
        return [
            Interaction(
                user_id=str(r[0]) if r[0] is not None else None,
                session_id=str(r[1]),
                type=str(r[2]),
                product_id=str(r[3]),
                created_at=r[4],  # type: ignore[arg-type]
            )
            for r in rows
        ]

    def baskets(self) -> list[Basket]:
        with self._connect() as conn:
            rows = conn.execute(BASKETS_SQL).fetchall()
        grouped: dict[str, list[str]] = defaultdict(list)
        created: dict[str, datetime] = {}
        for order_id, product_id, created_at in rows:
            grouped[str(order_id)].append(str(product_id))
            if isinstance(created_at, datetime):
                created[str(order_id)] = created_at
        return [
            Basket(
                order_id=oid, product_ids=tuple(dict.fromkeys(pids)), created_at=created.get(oid)
            )
            for oid, pids in grouped.items()
        ]

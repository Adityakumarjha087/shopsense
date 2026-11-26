"""Integration test against a real Postgres (runs only when TEST_DATABASE_URL is set)."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest

from shopsense_ml.config import Settings
from shopsense_ml.data.postgres import PostgresRepository
from shopsense_ml.data.repository import load_dataset
from shopsense_ml.training import train

DSN = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="TEST_DATABASE_URL not set")

DDL = """
CREATE TYPE "EventType" AS ENUM ('VIEW','ADD_TO_CART','WISHLIST','PURCHASE');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING','PAID','PAYMENT_FAILED','SHIPPED','DELIVERED',
  'CANCELLED','REFUNDED');
CREATE TABLE categories (id text PRIMARY KEY, slug text, name text);
CREATE TABLE products (id text PRIMARY KEY, name text, description text, brand text,
  category_id text REFERENCES categories(id), base_price int, tags text[], rating_avg float8,
  rating_count int, is_active boolean, created_at timestamptz DEFAULT now());
CREATE TABLE events (id bigserial PRIMARY KEY, user_id text, session_id text,
  type "EventType", product_id text, created_at timestamptz);
CREATE TABLE orders (id text PRIMARY KEY, user_id text, status "OrderStatus",
  created_at timestamptz);
CREATE TABLE order_items (id text PRIMARY KEY, order_id text, product_id text, quantity int);
"""


@pytest.fixture
def schema() -> Iterator[str]:
    import psycopg

    assert DSN
    name = f"ml_test_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA "{name}"')
        conn.execute(f'SET search_path TO "{name}"')
        conn.execute(DDL)
        conn.execute(
            "INSERT INTO categories VALUES ('c1','outerwear','Outerwear'),('c2','audio','Audio')"
        )
        for i in range(12):
            cat = "c1" if i < 6 else "c2"
            conn.execute(
                "INSERT INTO products VALUES (%s,%s,%s,'Acme',%s,1000,%s,4.2,10,%s)",
                (
                    f"p{i}",
                    f"Product {i}",
                    "warm winter jacket" if cat == "c1" else "wireless audio",
                    cat,
                    ["tag"],
                    i != 11,
                ),
            )
        for u in range(8):
            for i in range(6):
                pid = f"p{(i + (0 if u % 2 else 6)) % 11}"
                conn.execute(
                    "INSERT INTO events (user_id, session_id, type, product_id, created_at) "
                    "VALUES (%s,%s,'VIEW',%s, now() - make_interval(hours => %s))",
                    (f"u{u}" if u < 7 else None, f"s{u}", pid, 100 - i),
                )
        conn.execute(
            "INSERT INTO orders VALUES ('o1','u1','PAID',now()),"
            "('o2','u1','PENDING',now()),('o3','u2','DELIVERED',now())"
        )
        conn.execute(
            "INSERT INTO order_items VALUES ('i1','o1','p0',1),('i2','o1','p1',1),"
            "('i3','o2','p2',1),('i4','o3','p0',1),('i5','o3','p1',2),('i6','o3','p0',1)"
        )
    yield name
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute(f'DROP SCHEMA "{name}" CASCADE')


def test_postgres_repository_reads_contract_tables(schema: str, settings: Settings) -> None:
    assert DSN
    repo = PostgresRepository(DSN, schema=schema)
    products = repo.products()
    assert len(products) == 11  # inactive excluded
    assert products[0].category in {"Outerwear", "Audio"} and products[0].tags == ("tag",)
    interactions = repo.interactions()
    assert len(interactions) == 48
    assert any(e.user_id is None for e in interactions)
    baskets = {b.order_id: b.product_ids for b in repo.baskets()}
    assert baskets == {"o1": ("p0", "p1"), "o3": ("p0", "p1")}
    result = train(load_dataset(repo), settings, persist=False)
    assert result.bundle.rules.for_item("p0", 1)[0].consequent == "p1"

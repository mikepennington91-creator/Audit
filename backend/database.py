"""Small async document store backed by PostgreSQL JSONB.

The application historically used Motor directly.  This adapter implements the
small subset of the Motor collection API that Infinit Audit uses, allowing the
existing API to move to Supabase PostgreSQL without changing its public
behaviour.  New relational tables can be introduced alongside this store as
features are expanded.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import asyncpg


_FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _field_expression(field: str) -> str:
    if not _FIELD_NAME.fullmatch(field):
        raise ValueError(f"Unsupported document field: {field!r}")
    return f"data ->> '{field}'"


def _text_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


class _WhereBuilder:
    def __init__(self, start_at: int = 2):
        self.args: list[Any] = []
        self.start_at = start_at

    def add(self, value: Any) -> str:
        self.args.append(value)
        return f"${self.start_at + len(self.args) - 1}"

    def build(self, query: Optional[Dict[str, Any]]) -> str:
        if not query:
            return "TRUE"

        clauses: list[str] = []
        for field, condition in query.items():
            if field == "$or":
                branches = [self.build(branch) for branch in condition]
                clauses.append(f"({' OR '.join(branches)})" if branches else "FALSE")
                continue

            expression = _field_expression(field)
            if isinstance(condition, dict):
                operator_clauses: list[str] = []
                for operator, value in condition.items():
                    if operator == "$in":
                        values = [_text_value(item) for item in value]
                        placeholder = self.add(values)
                        operator_clauses.append(
                            f"{expression} = ANY({placeholder}::text[])"
                        )
                    elif operator == "$gte":
                        operator_clauses.append(
                            f"{expression} >= {self.add(_text_value(value))}"
                        )
                    elif operator == "$lte":
                        operator_clauses.append(
                            f"{expression} <= {self.add(_text_value(value))}"
                        )
                    elif operator == "$ieq":
                        operator_clauses.append(
                            f"LOWER({expression}) = LOWER({self.add(_text_value(value))})"
                        )
                    else:
                        raise ValueError(f"Unsupported query operator: {operator}")
                clauses.append(f"({' AND '.join(operator_clauses)})")
            elif condition is None:
                # Match both a missing key and an explicit JSON null, as Mongo does.
                clauses.append(
                    f"(data -> '{field}' IS NULL OR data -> '{field}' = 'null'::jsonb)"
                )
            else:
                clauses.append(f"{expression} = {self.add(_text_value(condition))}")

        return " AND ".join(clauses) if clauses else "TRUE"


@dataclass
class InsertOneResult:
    inserted_id: str


@dataclass
class UpdateResult:
    matched_count: int
    modified_count: int


@dataclass
class DeleteResult:
    deleted_count: int


def _apply_projection(
    document: Dict[str, Any], projection: Optional[Dict[str, int]]
) -> Dict[str, Any]:
    result = dict(document)
    if not projection:
        return result

    excluded = {
        field
        for field, include in projection.items()
        if include == 0 and field != "_id"
    }
    for field in excluded:
        result.pop(field, None)
    return result


def _decode_document(value: Any) -> Dict[str, Any]:
    # asyncpg returns json/jsonb as text unless a custom codec is installed.
    if isinstance(value, str):
        value = json.loads(value)
    return dict(value)


class PostgresCursor:
    def __init__(
        self,
        collection: "PostgresCollection",
        query: Optional[Dict[str, Any]],
        projection: Optional[Dict[str, int]],
    ):
        self.collection = collection
        self.query = query or {}
        self.projection = projection
        self.sort_field: Optional[str] = None
        self.sort_direction = 1
        self.result_limit: Optional[int] = None

    def sort(self, field: str, direction: int) -> "PostgresCursor":
        _field_expression(field)
        self.sort_field = field
        self.sort_direction = direction
        return self

    def limit(self, count: int) -> "PostgresCursor":
        self.result_limit = count
        return self

    async def to_list(self, length: int) -> list[Dict[str, Any]]:
        where = _WhereBuilder()
        where_sql = where.build(self.query)
        sql = "SELECT data FROM app_documents WHERE collection = $1 AND " + where_sql

        if self.sort_field:
            direction = "DESC" if self.sort_direction < 0 else "ASC"
            sql += (
                f" ORDER BY {_field_expression(self.sort_field)} {direction} NULLS LAST"
            )

        effective_limit = (
            min(length, self.result_limit) if self.result_limit is not None else length
        )
        sql += f" LIMIT {int(effective_limit)}"
        rows = await self.collection.database.pool.fetch(
            sql, self.collection.name, *where.args
        )
        return [
            _apply_projection(_decode_document(row["data"]), self.projection)
            for row in rows
        ]


class PostgresCollection:
    def __init__(self, database: "PostgresDatabase", name: str):
        if not _FIELD_NAME.fullmatch(name):
            raise ValueError(f"Unsupported collection name: {name!r}")
        self.database = database
        self.name = name

    def find(
        self,
        query: Optional[Dict[str, Any]] = None,
        projection: Optional[Dict[str, int]] = None,
    ) -> PostgresCursor:
        return PostgresCursor(self, query, projection)

    async def find_one(
        self,
        query: Optional[Dict[str, Any]] = None,
        projection: Optional[Dict[str, int]] = None,
    ) -> Optional[Dict[str, Any]]:
        results = await self.find(query, projection).limit(1).to_list(1)
        return results[0] if results else None

    async def insert_one(self, document: Dict[str, Any]) -> InsertOneResult:
        document_id = str(document.get("id") or "")
        if not document_id:
            raise ValueError(f"Documents in {self.name} must contain a non-empty id")
        payload = dict(document)
        payload.pop("_id", None)
        await self.database.pool.execute(
            "INSERT INTO app_documents (collection, id, data) VALUES ($1, $2, $3::jsonb)",
            self.name,
            document_id,
            json.dumps(payload),
        )
        return InsertOneResult(inserted_id=document_id)

    async def upsert_one(self, document: Dict[str, Any]) -> InsertOneResult:
        """Used by the one-off MongoDB migration utility."""
        document_id = str(document.get("id") or "")
        if not document_id:
            raise ValueError(f"Documents in {self.name} must contain a non-empty id")
        payload = dict(document)
        payload.pop("_id", None)
        await self.database.pool.execute(
            """
            INSERT INTO app_documents (collection, id, data)
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (collection, id)
            DO UPDATE SET data = EXCLUDED.data, updated_at = now()
            """,
            self.name,
            document_id,
            json.dumps(payload),
        )
        return InsertOneResult(inserted_id=document_id)

    async def insert_one_if_absent(self, document: Dict[str, Any]) -> bool:
        """Atomically insert by ID without overwriting an existing document.

        Callers seeding shared defaults must use a deterministic ID for the
        logical record. The existing (collection, id) primary key then also
        protects concurrent requests across backend workers.
        """
        document_id = str(document.get("id") or "")
        if not document_id:
            raise ValueError(f"Documents in {self.name} must contain a non-empty id")
        payload = dict(document)
        payload.pop("_id", None)
        result = await self.database.pool.fetchrow(
            """
            INSERT INTO app_documents (collection, id, data)
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (collection, id) DO NOTHING
            RETURNING id
            """,
            self.name,
            document_id,
            json.dumps(payload),
        )
        return result is not None

    async def update_one(
        self, query: Dict[str, Any], update: Dict[str, Any]
    ) -> UpdateResult:
        if set(update) != {"$set"}:
            raise ValueError("Only $set updates are supported")

        where = _WhereBuilder(start_at=3)
        where_sql = where.build(query)
        changes = update["$set"]
        result = await self.database.pool.fetchrow(
            f"""
            WITH target AS (
                SELECT collection, id
                FROM app_documents
                WHERE collection = $1 AND {where_sql}
                LIMIT 1
            )
            UPDATE app_documents AS documents
            SET data = documents.data || $2::jsonb, updated_at = now()
            FROM target
            WHERE documents.collection = target.collection AND documents.id = target.id
            RETURNING documents.id
            """,
            self.name,
            json.dumps(changes),
            *where.args,
        )
        matched = 1 if result else 0
        return UpdateResult(matched_count=matched, modified_count=matched)

    async def delete_one(self, query: Dict[str, Any]) -> DeleteResult:
        where = _WhereBuilder()
        where_sql = where.build(query)
        result = await self.database.pool.fetchrow(
            f"""
            DELETE FROM app_documents
            WHERE (collection, id) IN (
                SELECT collection, id FROM app_documents
                WHERE collection = $1 AND {where_sql}
                LIMIT 1
            )
            RETURNING id
            """,
            self.name,
            *where.args,
        )
        return DeleteResult(deleted_count=1 if result else 0)

    async def count_documents(self, query: Optional[Dict[str, Any]] = None) -> int:
        where = _WhereBuilder()
        where_sql = where.build(query)
        return await self.database.pool.fetchval(
            f"SELECT count(*) FROM app_documents WHERE collection = $1 AND {where_sql}",
            self.name,
            *where.args,
        )

    async def create_index(self, field: str, unique: bool = False) -> None:
        # The schema owns the indexes.  Keep this method for Motor API compatibility.
        _field_expression(field)


class PostgresDatabase:
    def __init__(
        self, database_url: str, min_pool_size: int = 1, max_pool_size: int = 5
    ):
        if not database_url:
            raise RuntimeError("DATABASE_URL must be configured")
        self.database_url = database_url
        self.min_pool_size = min_pool_size
        self.max_pool_size = max_pool_size
        self.pool: asyncpg.Pool | None = None
        self._collections: Dict[str, PostgresCollection] = {}

    async def connect(self) -> None:
        self.pool = await asyncpg.create_pool(
            dsn=self.database_url,
            min_size=self.min_pool_size,
            max_size=self.max_pool_size,
            statement_cache_size=0,
        )
        schema_path = Path(__file__).with_name("supabase_schema.sql")
        async with self.pool.acquire() as connection:
            await connection.execute(schema_path.read_text(encoding="utf-8"))

    async def close(self) -> None:
        if self.pool:
            await self.pool.close()
            self.pool = None

    async def ping(self) -> bool:
        if not self.pool:
            return False
        return (await self.pool.fetchval("SELECT 1")) == 1

    def __getattr__(self, name: str) -> PostgresCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._collections:
            self._collections[name] = PostgresCollection(self, name)
        return self._collections[name]

    def collection(self, name: str) -> PostgresCollection:
        return getattr(self, name)

"""Postgres + pgvector storage for scraped reports and chat history."""
import os

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql:///crawler")

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS scraped_items (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  embedding VECTOR(768),
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def connect():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)


def init_schema():
    with connect() as conn:
        conn.execute(SCHEMA)


def purge_old(days=14):
    with connect() as conn:
        conn.execute("DELETE FROM scraped_items WHERE scraped_at < now() - interval '%s days'" % days)


def _vec(embedding):
    """pgvector has no Python-list adapter without the extra `pgvector` package; cast a literal instead."""
    return "[" + ",".join(map(str, embedding)) + "]"


def insert_scraped_item(symbol, markdown, embedding):
    with connect() as conn:
        conn.execute(
            "INSERT INTO scraped_items (symbol, content_markdown, embedding) VALUES (%s, %s, %s::vector)",
            (symbol, markdown, _vec(embedding)),
        )


def list_recent_items(limit=20):
    with connect() as conn:
        return conn.execute(
            "SELECT id, symbol, content_markdown, scraped_at FROM scraped_items "
            "ORDER BY scraped_at DESC LIMIT %s",
            (limit,),
        ).fetchall()


def list_symbols():
    with connect() as conn:
        return conn.execute(
            "SELECT symbol, count(*) AS report_count, max(scraped_at) AS last_scraped "
            "FROM scraped_items GROUP BY symbol ORDER BY max(scraped_at) DESC"
        ).fetchall()


def list_items_for_symbol(symbol):
    with connect() as conn:
        return conn.execute(
            "SELECT id, symbol, content_markdown, scraped_at FROM scraped_items "
            "WHERE symbol = %s ORDER BY scraped_at DESC",
            (symbol,),
        ).fetchall()


def delete_item(item_id):
    with connect() as conn:
        conn.execute("DELETE FROM scraped_items WHERE id = %s", (item_id,))


def similarity_search(query_embedding, limit=5):
    with connect() as conn:
        return conn.execute(
            "SELECT id, symbol, content_markdown, scraped_at FROM scraped_items "
            "ORDER BY embedding <=> %s::vector LIMIT %s",
            (_vec(query_embedding), limit),
        ).fetchall()


def ensure_session(session_id):
    """Client generates the id (crypto.randomUUID()); insert it on first use."""
    with connect() as conn:
        conn.execute(
            "INSERT INTO chat_sessions (id) VALUES (%s) ON CONFLICT (id) DO NOTHING",
            (session_id,),
        )


def set_session_title(session_id, title):
    with connect() as conn:
        conn.execute("UPDATE chat_sessions SET title = %s WHERE id = %s", (title, session_id))


def list_sessions():
    with connect() as conn:
        return conn.execute(
            "SELECT id, title, created_at FROM chat_sessions ORDER BY created_at DESC"
        ).fetchall()


def add_message(session_id, role, content):
    with connect() as conn:
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (%s, %s, %s)",
            (session_id, role, content),
        )


def list_messages(session_id):
    with connect() as conn:
        return conn.execute(
            "SELECT role, content, created_at FROM chat_messages "
            "WHERE session_id = %s ORDER BY created_at",
            (session_id,),
        ).fetchall()

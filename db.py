"""Postgres + pgvector storage for scraped reports and chat history."""
import os
from datetime import datetime, timedelta, timezone

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

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
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS model TEXT;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_news (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  sentiment_label TEXT,
  sentiment_score REAL,
  source TEXT,
  origin TEXT,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_news_symbol_idx ON stock_news (symbol);
ALTER TABLE stock_news ADD COLUMN IF NOT EXISTS sentiment_label TEXT;
ALTER TABLE stock_news ADD COLUMN IF NOT EXISTS sentiment_score REAL;
ALTER TABLE stock_news ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE stock_news ADD COLUMN IF NOT EXISTS origin TEXT;

-- Cogencis's general "what's moving" feed (not scoped to one stock) - refetched wholesale at
-- most once a day (see api.py's top-news endpoint), independent of any single symbol's cache.
-- isins is the raw Cogencis field (comma-separated "ISIN TICKER.BS TICKER.NS" groups) kept as-is
-- so which watchlisted stocks a story affects can be recomputed at read time as the watchlist
-- changes, rather than baked in at scrape time.
CREATE TABLE IF NOT EXISTS top_news (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT NOT NULL UNIQUE,
  published_at TIMESTAMPTZ,
  source TEXT,
  isins TEXT,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS top_news_time_idx ON top_news (published_at DESC);

-- Permanent symbol->ISIN cache - an ISIN never changes for a listed security, so unlike the news
-- caches above this has no TTL; avoids a live yfinance call for every symbol on every top-news
-- page load.
CREATE TABLE IF NOT EXISTS symbol_isin (
  symbol TEXT PRIMARY KEY,
  isin TEXT NOT NULL
);
ALTER TABLE stock_news ADD COLUMN IF NOT EXISTS origin TEXT;

CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY,
  list_name TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Named lists, tracked independently of watchlist rows so an empty list (no stocks yet) still
-- shows up as a tab, and so tab order (position) is user-controlled via drag-and-drop rather
-- than always alphabetical. A list_name appearing in `watchlist` but not here (e.g. legacy data)
-- is still treated as a valid list, just ordered after the registered ones - see
-- list_watchlist_names.
CREATE TABLE IF NOT EXISTS watchlists (
  name TEXT PRIMARY KEY,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE watchlists ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- One-time fixup for rows inserted before `position` existed (all defaulted to 0, so order was
-- ambiguous) - orders them by creation time. Never fires again once positions are distinct.
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM watchlists WHERE position = 0) > 1 THEN
    UPDATE watchlists w SET position = sub.rn
    FROM (SELECT name, ROW_NUMBER() OVER (ORDER BY created_at) AS rn FROM watchlists) sub
    WHERE w.name = sub.name;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS stock_events (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  event_type TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  headline TEXT NOT NULL,
  detail TEXT,
  url TEXT,
  event_time TIMESTAMPTZ,
  sentiment_label TEXT,
  sentiment_score REAL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, event_type, dedup_key)
);
CREATE INDEX IF NOT EXISTS stock_events_symbol_idx ON stock_events (symbol);
CREATE INDEX IF NOT EXISTS stock_events_time_idx ON stock_events (event_time DESC);

-- User-defined "should I act on this" criteria - bridges events/indicators to a decision without
-- the app itself giving advice: the user writes the bar in plain English (rule_text, e.g. "P/E
-- under 25 AND no negative events in last 14 days AND EMA20 above EMA50"), the LLM parses it once
-- into the structured columns below at creation time, and the app just checks whether it's
-- currently met - see llm.parse_watch_rule and rules.evaluate. Not tied to one stock: a rule is
-- defined once by name and can be checked against any symbol (or the whole watchlist) at check
-- time. All parsed criteria are optional (NULL = not checked).
CREATE TABLE IF NOT EXISTS watch_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rule_text TEXT NOT NULL DEFAULT '',
  max_pe REAL,
  ema_short INTEGER,
  ema_long INTEGER,
  no_negative_events_days INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE watch_rules ADD COLUMN IF NOT EXISTS rule_text TEXT NOT NULL DEFAULT '';

-- Migrates rules created before this was made stock-agnostic: drop the old per-symbol column and
-- its composite unique constraint, then enforce uniqueness on name alone.
ALTER TABLE watch_rules DROP COLUMN IF EXISTS symbol;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'watch_rules'::regclass AND contype = 'u'
  ) THEN
    ALTER TABLE watch_rules ADD CONSTRAINT watch_rules_name_key UNIQUE (name);
  END IF;
END $$;

-- Fetch-once cache for live scraper calls (price/quote/chart/financials) that had no caching at
-- all before - avoids re-hitting Yahoo/NSE on every page view/poll. TTL-checked at read time,
-- same pattern as stock_news; cleared wholesale by the "Reload" button (POST /api/cache/clear).
CREATE TABLE IF NOT EXISTS stock_cache (
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL,
  data JSONB NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, kind)
);

-- Durable daily OHLCV time series, one row per symbol per trading day. Backfilled once (1y) per
-- symbol, then only the days after the latest stored date are ever fetched again - this is what
-- makes indicator computation (EMA crossover etc.) over many symbols cheap: read from here, no
-- live re-fetch per computation.
CREATE TABLE IF NOT EXISTS price_history (
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume BIGINT NOT NULL,
  PRIMARY KEY (symbol, date)
);
CREATE INDEX IF NOT EXISTS price_history_symbol_date_idx ON price_history (symbol, date DESC);

-- Full available history (yfinance period='max'), kept in its own table rather than mixed into
-- price_history - that one is a cheap 1y default window synced for every watchlisted symbol on
-- every scan; max history is a much bigger, explicitly user-triggered one-off per symbol, and
-- keeping the tables separate means the default sync never has to reason about "how much history
-- does this symbol already have" beyond its own 1y window.
CREATE TABLE IF NOT EXISTS price_history_max (
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume BIGINT NOT NULL,
  PRIMARY KEY (symbol, date)
);
CREATE INDEX IF NOT EXISTS price_history_max_symbol_date_idx ON price_history_max (symbol, date DESC);
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


def search_symbols(query="", limit=30):
    """Distinct scraped symbols matching a case-insensitive substring, most recent first."""
    with connect() as conn:
        return conn.execute(
            "SELECT symbol, max(scraped_at) AS last_scraped FROM scraped_items "
            "WHERE symbol ILIKE %s GROUP BY symbol ORDER BY last_scraped DESC LIMIT %s",
            (f"%{query}%", limit),
        ).fetchall()


def list_items_for_symbol(symbol):
    with connect() as conn:
        return conn.execute(
            "SELECT id, symbol, content_markdown, scraped_at FROM scraped_items "
            "WHERE symbol = %s ORDER BY scraped_at DESC",
            (symbol,),
        ).fetchall()


def has_recent_item(symbol, hours=24):
    """True if symbol has a scraped report from within the last `hours` - skip re-analyzing it."""
    with connect() as conn:
        row = conn.execute(
            "SELECT max(scraped_at) AS latest FROM scraped_items WHERE symbol = %s", (symbol,)
        ).fetchone()
    return bool(row and row["latest"] and row["latest"] > datetime.now(timezone.utc) - timedelta(hours=hours))


def latest_item_markdown(symbol):
    with connect() as conn:
        row = conn.execute(
            "SELECT content_markdown FROM scraped_items WHERE symbol = %s "
            "ORDER BY scraped_at DESC LIMIT 1",
            (symbol,),
        ).fetchone()
    return row["content_markdown"] if row else None


def delete_item(item_id):
    with connect() as conn:
        conn.execute("DELETE FROM scraped_items WHERE id = %s", (item_id,))


def delete_symbol(symbol):
    """Deletes every scraped/analyzed report for a symbol - removes it from the tracked list entirely."""
    with connect() as conn:
        conn.execute("DELETE FROM scraped_items WHERE symbol = %s", (symbol,))


def similarity_search(query_embedding, limit=5):
    with connect() as conn:
        return conn.execute(
            "SELECT id, symbol, content_markdown, scraped_at FROM scraped_items "
            "ORDER BY embedding <=> %s::vector LIMIT %s",
            (_vec(query_embedding), limit),
        ).fetchall()


def get_cached_news(symbol, max_age_hours=24):
    """Returns cached news for symbol if scraped within max_age_hours, else None (caller should re-scrape)."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT title, summary, url, published_at, sentiment_label, sentiment_score, source, origin, "
            "scraped_at FROM stock_news WHERE symbol = %s ORDER BY published_at DESC NULLS LAST",
            (symbol,),
        ).fetchall()
    if not rows:
        return None
    newest_scrape = max(r["scraped_at"] for r in rows)
    if newest_scrape < datetime.now(timezone.utc) - timedelta(hours=max_age_hours):
        return None
    return rows


def save_news(symbol, items):
    """Replaces the cached news for a symbol wholesale with a freshly scraped list."""
    with connect() as conn:
        conn.execute("DELETE FROM stock_news WHERE symbol = %s", (symbol,))
        for item in items:
            conn.execute(
                "INSERT INTO stock_news (symbol, title, summary, url, published_at, "
                "sentiment_label, sentiment_score, source, origin) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    symbol, item["title"], item["summary"], item["url"], item.get("published_at"),
                    item.get("sentiment_label"), item.get("sentiment_score"), item.get("source"),
                    item.get("origin"),
                ),
            )


def get_cached_top_news(max_age_hours=24):
    """Returns cached top-news wholesale if scraped within max_age_hours, else None (caller
    should re-scrape all pages)."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT title, summary, url, published_at, source, isins, scraped_at "
            "FROM top_news ORDER BY published_at DESC NULLS LAST"
        ).fetchall()
    if not rows:
        return None
    newest_scrape = max(r["scraped_at"] for r in rows)
    if newest_scrape < datetime.now(timezone.utc) - timedelta(hours=max_age_hours):
        return None
    return rows


def save_top_news(items):
    """Replaces the cached top-news wholesale with a freshly scraped list."""
    with connect() as conn:
        conn.execute("DELETE FROM top_news")
        for item in items:
            conn.execute(
                "INSERT INTO top_news (title, summary, url, published_at, source, isins) "
                "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (url) DO NOTHING",
                (item["title"], item["summary"], item["url"], item.get("published_at"),
                 item.get("source"), item.get("isins")),
            )


def get_isin_cache(symbol):
    with connect() as conn:
        row = conn.execute("SELECT isin FROM symbol_isin WHERE symbol = %s", (symbol,)).fetchone()
    return row["isin"] if row else None


def set_isin_cache(symbol, isin):
    with connect() as conn:
        conn.execute(
            "INSERT INTO symbol_isin (symbol, isin) VALUES (%s, %s) "
            "ON CONFLICT (symbol) DO UPDATE SET isin = excluded.isin",
            (symbol, isin),
        )


def list_watchlist():
    """Every watchlisted symbol with its list name. PK on symbol - a stock lives in one list."""
    with connect() as conn:
        return conn.execute(
            "SELECT symbol, list_name FROM watchlist ORDER BY list_name, added_at"
        ).fetchall()


_NEXT_POSITION_INSERT = (
    "INSERT INTO watchlists (name, position) "
    "SELECT %s, COALESCE(MAX(position), 0) + 1 FROM watchlists "
    "ON CONFLICT (name) DO NOTHING"
)


def set_watchlist(symbol, list_name):
    """Add to a list, or move between lists - same upsert. Also registers the list name (appended
    after the current last tab) so it persists as a tab even if this symbol is later moved out."""
    with connect() as conn:
        conn.execute(_NEXT_POSITION_INSERT, (list_name,))
        conn.execute(
            "INSERT INTO watchlist (symbol, list_name) VALUES (%s, %s) "
            "ON CONFLICT (symbol) DO UPDATE SET list_name = excluded.list_name",
            (symbol, list_name),
        )


def remove_from_watchlist(symbol):
    with connect() as conn:
        conn.execute("DELETE FROM watchlist WHERE symbol = %s", (symbol,))


def list_watchlist_names():
    """All list names in user-chosen (drag-and-drop) order. Auto-registers any list_name still
    referenced by a watchlist row but never registered (e.g. data from before `watchlists`
    existed), appending them alphabetically, so every list becomes draggable from here on."""
    with connect() as conn:
        orphans = conn.execute(
            "SELECT DISTINCT list_name FROM watchlist WHERE list_name NOT IN (SELECT name FROM watchlists) "
            "ORDER BY list_name"
        ).fetchall()
        for row in orphans:
            conn.execute(_NEXT_POSITION_INSERT, (row["list_name"],))
        rows = conn.execute("SELECT name FROM watchlists ORDER BY position, name").fetchall()
    return [r["name"] for r in rows]


def create_watchlist(name):
    with connect() as conn:
        conn.execute(_NEXT_POSITION_INSERT, (name,))


def rename_watchlist(old_name, new_name):
    with connect() as conn:
        conn.execute("UPDATE watchlist SET list_name = %s WHERE list_name = %s", (new_name, old_name))
        renamed = conn.execute("UPDATE watchlists SET name = %s WHERE name = %s", (new_name, old_name))
        if renamed.rowcount == 0:
            conn.execute(_NEXT_POSITION_INSERT, (new_name,))


def delete_watchlist(name):
    """Deletes a list's own row - caller (API) must confirm it's empty first, since a nonempty
    list is really just implied by its symbols' list_name and would reappear on the next read."""
    with connect() as conn:
        conn.execute("DELETE FROM watchlists WHERE name = %s", (name,))


def reorder_watchlists(names):
    """Sets tab order from a full drag-and-drop-reordered name list - position = index."""
    with connect() as conn:
        for i, name in enumerate(names):
            conn.execute("UPDATE watchlists SET position = %s WHERE name = %s", (i, name))


def insert_event(symbol, event_type, dedup_key, headline, detail, url, event_time,
                 sentiment_label, sentiment_score):
    """Inserts one event; returns True if it was new, False if the dedup key already existed."""
    with connect() as conn:
        row = conn.execute(
            "INSERT INTO stock_events (symbol, event_type, dedup_key, headline, detail, url, "
            "event_time, sentiment_label, sentiment_score) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (symbol, event_type, dedup_key) DO NOTHING RETURNING id",
            (symbol, event_type, dedup_key, headline, detail, url, event_time,
             sentiment_label, sentiment_score),
        ).fetchone()
    return row is not None


def list_events(list_name=None, symbol=None, from_date=None, to_date=None, limit=100):
    """Event feed, newest first. list_name scopes to one watchlist via join; symbol to one stock;
    from_date/to_date (inclusive, YYYY-MM-DD) filter on event_time - events with no event_time
    (shouldn't happen now that every scan path sets one, but defensively) are excluded once a
    date filter is applied, since they can't be placed in the range."""
    query = (
        "SELECT e.id, e.symbol, e.event_type, e.headline, e.detail, e.url, e.event_time, "
        "e.sentiment_label, e.sentiment_score, e.scraped_at, w.list_name "
        "FROM stock_events e LEFT JOIN watchlist w ON w.symbol = e.symbol"
    )
    conditions, params = [], []
    if list_name:
        conditions.append("w.list_name = %s")
        params.append(list_name)
    if symbol:
        conditions.append("e.symbol = %s")
        params.append(symbol)
    if from_date:
        conditions.append("e.event_time >= %s")
        params.append(from_date)
    if to_date:
        conditions.append("e.event_time < %s::date + interval '1 day'")
        params.append(to_date)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY e.event_time DESC NULLS LAST, e.scraped_at DESC LIMIT %s"
    params.append(limit)
    with connect() as conn:
        return conn.execute(query, params).fetchall()


def list_watch_rules():
    with connect() as conn:
        return conn.execute("SELECT * FROM watch_rules ORDER BY name").fetchall()


def get_watch_rule(name):
    with connect() as conn:
        return conn.execute("SELECT * FROM watch_rules WHERE name = %s", (name,)).fetchone()


def get_watch_rule_by_id(rule_id):
    with connect() as conn:
        return conn.execute("SELECT * FROM watch_rules WHERE id = %s", (rule_id,)).fetchone()


def create_watch_rule(name, rule_text, max_pe, ema_short, ema_long, no_negative_events_days):
    with connect() as conn:
        conn.execute(
            "INSERT INTO watch_rules (name, rule_text, max_pe, ema_short, ema_long, "
            "no_negative_events_days) VALUES (%s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (name) DO UPDATE SET rule_text = excluded.rule_text, "
            "max_pe = excluded.max_pe, ema_short = excluded.ema_short, ema_long = excluded.ema_long, "
            "no_negative_events_days = excluded.no_negative_events_days",
            (name, rule_text, max_pe, ema_short, ema_long, no_negative_events_days),
        )


def delete_watch_rule(rule_id):
    with connect() as conn:
        conn.execute("DELETE FROM watch_rules WHERE id = %s", (rule_id,))


def get_cached(symbol, kind, max_age_minutes):
    """Returns cached data for (symbol, kind) if fresher than max_age_minutes, else None."""
    with connect() as conn:
        row = conn.execute(
            "SELECT data, cached_at FROM stock_cache WHERE symbol = %s AND kind = %s",
            (symbol, kind),
        ).fetchone()
    if not row or row["cached_at"] < datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes):
        return None
    return row["data"]


def set_cached(symbol, kind, data):
    with connect() as conn:
        conn.execute(
            "INSERT INTO stock_cache (symbol, kind, data, cached_at) VALUES (%s, %s, %s, now()) "
            "ON CONFLICT (symbol, kind) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at",
            (symbol, kind, Jsonb(data)),
        )


def clear_cache():
    with connect() as conn:
        conn.execute("DELETE FROM stock_cache")


def latest_price_date(symbol):
    """Latest stored trading date for symbol, or None if no history stored yet - tells the sync
    whether to backfill a full year or just fetch the gap since this date."""
    with connect() as conn:
        row = conn.execute(
            "SELECT max(date) AS latest FROM price_history WHERE symbol = %s", (symbol,)
        ).fetchone()
    return row["latest"] if row else None


def insert_price_bars(symbol, bars):
    """bars: list of {date, open, high, low, close, volume}. Upserts one connection/statement
    batch per call - safe to call repeatedly (e.g. re-running a sync overlaps by a day or two)."""
    if not bars:
        return
    with connect() as conn:
        conn.cursor().executemany(
            "INSERT INTO price_history (symbol, date, open, high, low, close, volume) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (symbol, date) DO UPDATE SET open = excluded.open, high = excluded.high, "
            "low = excluded.low, close = excluded.close, volume = excluded.volume",
            [(symbol, b["date"], b["open"], b["high"], b["low"], b["close"], b["volume"]) for b in bars],
        )


def earliest_price_date(symbol):
    with connect() as conn:
        row = conn.execute(
            "SELECT min(date) AS earliest FROM price_history WHERE symbol = %s", (symbol,)
        ).fetchone()
    return row["earliest"] if row else None


def price_history_since(symbol, start_date):
    """Ascending rows from start_date onward - the shape a chart wants (oldest bar first)."""
    with connect() as conn:
        return conn.execute(
            "SELECT date, open, high, low, close, volume FROM price_history "
            "WHERE symbol = %s AND date >= %s ORDER BY date",
            (symbol, start_date),
        ).fetchall()


def list_price_history(symbol, days=365):
    with connect() as conn:
        rows = conn.execute(
            "SELECT date, open, high, low, close, volume FROM price_history "
            "WHERE symbol = %s ORDER BY date DESC LIMIT %s",
            (symbol, days),
        ).fetchall()
    return list(reversed(rows))  # chronological order


def price_series(symbol, limit=100):
    """Chronological (date, close) pairs - the minimal input EMA computation needs, with dates
    so a crossover signal can also report when it happened."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT date, close FROM price_history WHERE symbol = %s ORDER BY date DESC LIMIT %s",
            (symbol, limit),
        ).fetchall()
    return list(reversed(rows))


def insert_max_bars(symbol, bars):
    """Same upsert shape as insert_price_bars, targeting price_history_max instead."""
    if not bars:
        return
    with connect() as conn:
        conn.cursor().executemany(
            "INSERT INTO price_history_max (symbol, date, open, high, low, close, volume) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (symbol, date) DO UPDATE SET open = excluded.open, high = excluded.high, "
            "low = excluded.low, close = excluded.close, volume = excluded.volume",
            [(symbol, b["date"], b["open"], b["high"], b["low"], b["close"], b["volume"]) for b in bars],
        )


def has_max_history(symbol):
    """Whether price_history_max has ever been collected for this symbol - the frontend uses
    this to decide whether to show the max-history section at all."""
    with connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM price_history_max WHERE symbol = %s LIMIT 1", (symbol,)
        ).fetchone()
    return row is not None


def list_max_history(symbol):
    with connect() as conn:
        rows = conn.execute(
            "SELECT date, open, high, low, close, volume FROM price_history_max "
            "WHERE symbol = %s ORDER BY date",
            (symbol,),
        ).fetchall()
    return rows


def watchlist_symbols(list_name=None):
    with connect() as conn:
        if list_name:
            rows = conn.execute(
                "SELECT symbol FROM watchlist WHERE list_name = %s", (list_name,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT symbol FROM watchlist").fetchall()
    return [r["symbol"] for r in rows]


DEFAULT_MODEL = "ollama/llama3.1"


def get_active_model():
    with connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'active_model'").fetchone()
    return row["value"] if row else DEFAULT_MODEL


def set_active_model(model):
    with connect() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('active_model', %s) "
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            (model,),
        )


def _get_setting(key, default=None):
    with connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = %s", (key,)).fetchone()
    return row["value"] if row else default


def _set_setting(key, value):
    with connect() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (%s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def get_litellm_base_url():
    return _get_setting("litellm_base_url")


def get_litellm_api_key():
    return _get_setting("litellm_api_key")


def set_litellm_config(base_url, api_key=None):
    """api_key=None leaves the stored key untouched - lets the UI update the URL alone
    without forcing the user to re-paste an already-saved key."""
    _set_setting("litellm_base_url", base_url)
    if api_key is not None:
        _set_setting("litellm_api_key", api_key)


def get_cogencis_token():
    return _get_setting("cogencis_token")


def set_cogencis_token(token):
    _set_setting("cogencis_token", token)


def set_session_model(session_id, model):
    with connect() as conn:
        conn.execute("UPDATE chat_sessions SET model = %s WHERE id = %s", (model, session_id))


def get_session_model(session_id):
    with connect() as conn:
        row = conn.execute("SELECT model FROM chat_sessions WHERE id = %s", (session_id,)).fetchone()
    return row["model"] if row else None


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
            "SELECT id, title, model, created_at FROM chat_sessions ORDER BY created_at DESC"
        ).fetchall()

def delete_session(session_id):
    """chat_messages has ON DELETE CASCADE on session_id, so this drops the transcript too."""
    with connect() as conn:
        conn.execute("DELETE FROM chat_sessions WHERE id = %s", (session_id,))


def clear_messages(session_id):
    """Wipes a session's transcript (the /clear command) but keeps the session row itself - same
    chatId, title, and model, just an empty history."""
    with connect() as conn:
        conn.execute("DELETE FROM chat_messages WHERE session_id = %s", (session_id,))


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

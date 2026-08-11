"""Postgres + pgvector storage for scraped reports and chat history."""
import json
import os
from datetime import date, datetime, timedelta, timezone

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
  symbol TEXT NOT NULL,
  list_name TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, list_name)
);

-- One-time migration from the old one-list-per-symbol schema (PK on symbol alone) to
-- many-to-many, so a stock can sit in multiple watchlists at once. Existing rows are already
-- unique per symbol, so they satisfy the new composite key with no data loss; never fires again
-- once the PK has 2 columns.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'watchlist'::regclass AND contype = 'p' AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE watchlist DROP CONSTRAINT watchlist_pkey;
    ALTER TABLE watchlist ADD CONSTRAINT watchlist_pkey PRIMARY KEY (symbol, list_name);
  END IF;
END $$;

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

-- Last known price per symbol for the paper-trading screens. Deliberately NOT stock_cache: that
-- one is a TTL cache that reads as "nothing" once expired and is truncated wholesale by the
-- "Reload" button, whereas this row's whole job is to still be there afterwards - it's what the
-- Holdings table marks positions to while a fresh quote is being fetched. Never expires; every
-- successful quote overwrites it (see services/quotes.paper_price).
-- `sector` rides along because the quote that carries the price carries it too (scraper's
-- QUOTE_FIELDS) - storing it here is free, and it's what the paper Overview's sector allocation
-- reads. It's a property of the listing rather than of this fetch, so an update never clears it.
CREATE TABLE IF NOT EXISTS paper_price_cache (
  symbol TEXT PRIMARY KEY,
  price REAL NOT NULL,
  sector TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE paper_price_cache ADD COLUMN IF NOT EXISTS sector TEXT;

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

-- Saved runs of the (currently single-strategy) EMA-crossover backtest - trades is the full
-- per-trade breakdown (JSONB, same shape backtest.run_ema_crossover returns), lessons is a
-- free-text note the user writes after reviewing a run so the "what did I learn" doesn't live
-- only in their head - shown alongside the stock's own page so it resurfaces next time they look
-- at that symbol instead of getting re-discovered (or re-forgotten) from scratch.
CREATE TABLE IF NOT EXISTS backtests (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  short_period INTEGER NOT NULL,
  long_period INTEGER NOT NULL,
  from_date DATE,
  to_date DATE,
  total_return_pct REAL,
  win_rate REAL,
  num_trades INTEGER,
  trades JSONB,
  lessons TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS backtests_symbol_idx ON backtests (symbol, created_at DESC);

-- Saved Pine Script templates for the Auto backtest tab - execution happens client-side (PineTS
-- in the browser) against OHLCV pulled from price_history, so this table only stores the script
-- text itself, nothing about any particular run.
CREATE TABLE IF NOT EXISTS auto_backtest_scripts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  script TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trading accounts the manual journal's trades belong to. One strategy per account by design -
-- comparing strategies means comparing accounts, so an account is always a single coherent
-- "this is the system I'm running with this money" unit, never a mixed bag.
-- max_position_size_type: 'currency' (absolute ₹) or 'percentage' (of the account's balance at
-- the time of the trade). Both caps are advisory - they surface a warning on the trade form
-- rather than rejecting the trade, since the journal records what you actually did, not what the
-- rules said you should have done.
CREATE TABLE IF NOT EXISTS trade_accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  strategy TEXT,
  strategy_explanation TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  max_position_size REAL,
  max_position_size_type TEXT NOT NULL DEFAULT 'currency',
  max_position_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 'journal' (hand-logged trades, the Manual Backtesting tab) or 'paper' (live-price simulation,
-- the Paper Trading page). A discriminator rather than a second accounts table: an account is the
-- same thing either way - a name, a strategy, a wallet, and position caps - and every balance and
-- cap function here already works per-account, so splitting the table would mean duplicating all
-- of it. Callers filter by kind; the two never share an account, so the balances stay separate.
ALTER TABLE trade_accounts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'journal';

-- Manually logged trades for the Manual backtest tab - a personal trade journal, not tied to
-- price_history/NSE at all (entry/exit/P&L are exactly what the user typed in, not computed from
-- market data). P&L, R:R, and return% are deliberately NOT stored here - they're derived from
-- entry/exit/stop/target/quantity and computed at read time (frontend) so editing a trade later
-- never leaves a stale derived value behind. `result` starts as that same auto-computed
-- profit/loss/neutral but is a real column since the user can override it by hand.
CREATE TABLE IF NOT EXISTS manual_trades (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  stop_loss REAL,
  target REAL,
  is_open BOOLEAN NOT NULL DEFAULT false,
  result TEXT,
  emotion TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  image_filename TEXT,
  traded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  setup TEXT,
  ideal_risk_amount REAL
);
CREATE INDEX IF NOT EXISTS manual_trades_traded_at_idx ON manual_trades (traded_at DESC);
ALTER TABLE manual_trades ADD COLUMN IF NOT EXISTS setup TEXT;
ALTER TABLE manual_trades ADD COLUMN IF NOT EXISTS ideal_risk_amount REAL;
ALTER TABLE manual_trades ADD COLUMN IF NOT EXISTS account_id INTEGER
  REFERENCES trade_accounts(id) ON DELETE SET NULL;
-- The ONE derived value this table does store, deliberately breaking the rule above: the account
-- wallet balance at the moment the trade was taken. It's a point-in-time fact, not a function of
-- this row - re-deriving it later would silently change every past trade's account-return% the
-- moment a deposit is backdated or an older trade is edited. Written once at trade creation and
-- never recomputed (see db.account_balance_at).
ALTER TABLE manual_trades ADD COLUMN IF NOT EXISTS account_balance_at_trade REAL;
CREATE INDEX IF NOT EXISTS manual_trades_account_idx ON manual_trades (account_id);
-- When the position was actually closed, as opposed to traded_at (when it was opened/journaled).
-- Optional: without it MAE/MFE can't be bounded, so those two metrics are simply not computed.
ALTER TABLE manual_trades ADD COLUMN IF NOT EXISTS exited_at TIMESTAMPTZ;
-- The second point-in-time snapshot, for the same reason as account_balance_at_trade above: what
-- the chart looked like when this trade was taken (trend, volatility regime, how extended the
-- entry was) plus how far it ran either way. Bars get split-adjusted and revised, so re-deriving
-- this later would silently rewrite the history the user is trying to learn from. Written once at
-- creation, or once on the edit that first supplies an exit - never overwritten. One JSONB blob
-- rather than a column per feature: the feature set will change, and this way that costs no DDL.
-- See trade_context.py.
ALTER TABLE manual_trades ADD COLUMN IF NOT EXISTS trade_context JSONB;

-- OPEN paper-trading positions only. A position leaves this table the moment it fully closes -
-- its realized outcome is written to manual_trades (tagged 'paper', under the paper account), so
-- closed paper trades are journal trades and every existing statistic - win rate, realized P&L,
-- equity curve, drawdown, R-multiples - applies to them with no parallel implementation.
--
-- stop_losses/targets are JSONB lists of {id, price, qty} legs, the exact shape Bar Replay's
-- orderEngine.js already uses, so partial/laddered exits mean the same thing in both places. A
-- leg triggering closes only its own slice; the position stays open at the reduced size.
CREATE TABLE IF NOT EXISTS paper_positions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES trade_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,          -- 'long' | 'short'
  order_type TEXT NOT NULL,         -- 'market' | 'limit'
  status TEXT NOT NULL,             -- 'pending' (resting limit) | 'open' (filled)
  quantity REAL NOT NULL,           -- remaining size; shrinks as ladder legs fill
  entry_price REAL NOT NULL,        -- limit price while pending, fill price once open
  stop_losses JSONB NOT NULL DEFAULT '[]'::jsonb,
  targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at TIMESTAMPTZ            -- when it actually filled; null while pending
);
CREATE INDEX IF NOT EXISTS paper_positions_account_idx ON paper_positions (account_id);

-- Deposits and withdrawals against an account's wallet, plus manual corrections to the running
-- balance curve (broker true-ups that aren't trades themselves).
CREATE TABLE IF NOT EXISTS balance_adjustments (
  id SERIAL PRIMARY KEY,
  amount REAL NOT NULL,
  type TEXT NOT NULL, -- 'add' (deposit) | 'subtract' (withdrawal)
  reason TEXT,
  notes TEXT,
  adjusted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE balance_adjustments ADD COLUMN IF NOT EXISTS account_id INTEGER
  REFERENCES trade_accounts(id) ON DELETE CASCADE;

-- Daily usage-time + "did they analyze/review today" signals for the consistency/streak feature
-- (Profile modal). "traded" is deliberately NOT a column here - it's derived live from
-- manual_trades.created_at wherever needed, so it can never drift out of sync with the trade
-- journal itself.
CREATE TABLE IF NOT EXISTS daily_activity (
  date DATE PRIMARY KEY,
  seconds_active INTEGER NOT NULL DEFAULT 0,
  analyzed BOOLEAN NOT NULL DEFAULT false,
  reviewed BOOLEAN NOT NULL DEFAULT false
);

-- NSE's full listed-equity master (SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING, ISIN NUMBER
-- from the exchange's EQUITY_L.csv) - independent of scraped_items/watchlist, which only ever
-- hold symbols the user has actually looked at. This is the reference list the "manage stocks"
-- settings tab searches/browses; re-importing a fresh CSV just upserts, so it stays current.
CREATE TABLE IF NOT EXISTS stocks_master (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  series TEXT,
  listing_date DATE,
  isin TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stocks_master_name_idx ON stocks_master (name);
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
    """pgvector has no Python-list adapter without the extra `pgvector` package; cast a literal
    instead. None passes through as NULL (embedding step failed but the report itself is still
    worth keeping) - NULL::vector is valid SQL, it just won't surface in similarity_search."""
    return None if embedding is None else "[" + ",".join(map(str, embedding)) + "]"


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


def top_news_is_fresh(max_age_hours=24):
    """True if the top-news cache has been scraped within max_age_hours (caller should re-scrape
    the first page wholesale if not - see save_top_news)."""
    with connect() as conn:
        newest = conn.execute("SELECT max(scraped_at) AS t FROM top_news").fetchone()["t"]
    return bool(newest) and newest >= datetime.now(timezone.utc) - timedelta(hours=max_age_hours)


def count_top_news():
    with connect() as conn:
        return conn.execute("SELECT count(*) AS n FROM top_news").fetchone()["n"]


def get_top_news_page(offset, limit):
    """Paginated slice of the cached top-news feed, newest first."""
    with connect() as conn:
        return conn.execute(
            "SELECT title, summary, url, published_at, source, isins "
            "FROM top_news ORDER BY published_at DESC NULLS LAST OFFSET %s LIMIT %s",
            (offset, limit),
        ).fetchall()


def save_top_news(items):
    """Replaces the cached top-news wholesale with a freshly scraped list - used for the daily
    from-scratch refresh (force=true or a stale cache)."""
    with connect() as conn:
        conn.execute("DELETE FROM top_news")
        for item in items:
            conn.execute(
                "INSERT INTO top_news (title, summary, url, published_at, source, isins) "
                "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (url) DO NOTHING",
                (item["title"], item["summary"], item["url"], item.get("published_at"),
                 item.get("source"), item.get("isins")),
            )


def append_top_news(items):
    """Adds more (older) pages to the existing cache without clearing it - used when a scroll
    request needs deeper pages than what's cached so far."""
    with connect() as conn:
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
    """Every watchlisted symbol with its list name(s) - one row per (symbol, list) membership,
    since a stock can now live in more than one list."""
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
    """Adds symbol to a list (no-op if it's already there). Also registers the list name (appended
    after the current last tab) so it persists as a tab even if every symbol later leaves it."""
    with connect() as conn:
        conn.execute(_NEXT_POSITION_INSERT, (list_name,))
        conn.execute(
            "INSERT INTO watchlist (symbol, list_name) VALUES (%s, %s) "
            "ON CONFLICT (symbol, list_name) DO NOTHING",
            (symbol, list_name),
        )


def remove_from_watchlist(symbol, list_name=None):
    """Removes symbol from one list, or from every list it's in when list_name is omitted (used
    when the stock itself is deleted)."""
    with connect() as conn:
        if list_name is None:
            conn.execute("DELETE FROM watchlist WHERE symbol = %s", (symbol,))
        else:
            conn.execute(
                "DELETE FROM watchlist WHERE symbol = %s AND list_name = %s", (symbol, list_name)
            )


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
    # A symbol can belong to more than one list now - filtered to one list_name, the composite
    # (symbol, list_name) key means a plain join can't fan out; unfiltered, joining every
    # membership would duplicate the event row per list, so pick one arbitrarily via LATERAL.
    if list_name:
        query = (
            "SELECT e.id, e.symbol, e.event_type, e.headline, e.detail, e.url, e.event_time, "
            "e.sentiment_label, e.sentiment_score, e.scraped_at, w.list_name "
            "FROM stock_events e JOIN watchlist w ON w.symbol = e.symbol AND w.list_name = %s"
        )
        params = [list_name]
    else:
        query = (
            "SELECT e.id, e.symbol, e.event_type, e.headline, e.detail, e.url, e.event_time, "
            "e.sentiment_label, e.sentiment_score, e.scraped_at, w.list_name "
            "FROM stock_events e LEFT JOIN LATERAL "
            "(SELECT list_name FROM watchlist w2 WHERE w2.symbol = e.symbol LIMIT 1) w ON true"
        )
        params = []
    conditions = []
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


def attention_scores(list_name=None, symbol=None, baseline_days=30, recent_days=3):
    """Attention (event-coverage volume) for each symbol relative to its own recent history -
    recent_count is stock_events in the last `recent_days`; baseline_avg is the avg events/day
    over the `baseline_days` before that (the recent window is excluded from the baseline so a
    spike doesn't dilute its own comparison point). ratio = recent_avg / baseline_avg, None when
    there's no baseline yet (a symbol with zero prior events - any activity there counts as brand
    new attention, not "N times normal"). This is "is this stock getting more coverage than
    usual right now", distinct from any single event's sentiment or size - see
    docs/events-feed.md."""
    now = datetime.now(timezone.utc)
    recent_cutoff = now - timedelta(days=recent_days)
    baseline_cutoff = now - timedelta(days=baseline_days)
    # A symbol can belong to more than one list now. Filtered, the WHERE clause below narrows the
    # plain join back down to one row per symbol same as before; unfiltered, LATERAL picks one
    # membership instead of duplicating the symbol once per list it's in.
    join = (
        "LEFT JOIN watchlist w ON w.symbol = e.symbol"
        if list_name
        else "LEFT JOIN LATERAL (SELECT list_name FROM watchlist w2 WHERE w2.symbol = e.symbol LIMIT 1) w ON true"
    )
    query = (
        "SELECT e.symbol, w.list_name, "
        "COUNT(*) FILTER (WHERE e.event_time >= %s) AS recent_count, "
        "COUNT(*) FILTER (WHERE e.event_time >= %s AND e.event_time < %s) AS baseline_count "
        f"FROM stock_events e {join} "
        "WHERE e.event_time >= %s"
    )
    params = [recent_cutoff, baseline_cutoff, recent_cutoff, baseline_cutoff]
    if list_name:
        query += " AND w.list_name = %s"
        params.append(list_name)
    if symbol:
        query += " AND e.symbol = %s"
        params.append(symbol)
    query += " GROUP BY e.symbol, w.list_name"
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()

    baseline_window_days = max(baseline_days - recent_days, 1)
    results = []
    for r in rows:
        baseline_avg = r["baseline_count"] / baseline_window_days
        recent_avg = r["recent_count"] / recent_days
        ratio = round(recent_avg / baseline_avg, 2) if baseline_avg > 0 else None
        results.append({
            "symbol": r["symbol"],
            "list_name": r["list_name"],
            "recent_count": r["recent_count"],
            "baseline_count": r["baseline_count"],
            "baseline_avg": round(baseline_avg, 2),
            "ratio": ratio,
            "is_new_attention": baseline_avg == 0 and r["recent_count"] > 0,
        })
    # New-attention symbols (no baseline at all - can't express as "Nx normal") sort first, then
    # by ratio descending, then raw recent_count as a tiebreaker.
    results.sort(key=lambda r: (r["ratio"] is not None, -(r["ratio"] or 0), -r["recent_count"]))
    return results


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


def get_paper_prices(symbols):
    """{symbol: {"price", "sector", "fetched_at"}} for the symbols that have ever been quoted,
    however long ago. No TTL check on purpose - the caller wants a last-known price to show
    *while* the fresh one is on its way, and decides for itself whether the timestamp is old
    enough to act on."""
    symbols = list(symbols)
    if not symbols:
        return {}
    with connect() as conn:
        rows = conn.execute(
            "SELECT symbol, price, sector, fetched_at FROM paper_price_cache WHERE symbol = ANY(%s)",
            (symbols,),
        ).fetchall()
    return {
        r["symbol"]: {"price": float(r["price"]), "sector": r["sector"], "fetched_at": r["fetched_at"]}
        for r in rows
    }


def set_paper_price(symbol, price, sector=None):
    # COALESCE, not overwrite: a quote that came back without a sector must not erase the one an
    # earlier quote already established.
    with connect() as conn:
        conn.execute(
            "INSERT INTO paper_price_cache (symbol, price, sector, fetched_at) VALUES (%s, %s, %s, now()) "
            "ON CONFLICT (symbol) DO UPDATE SET price = excluded.price, "
            "sector = COALESCE(excluded.sector, paper_price_cache.sector), fetched_at = excluded.fetched_at",
            (symbol, price, sector),
        )


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


def bars_before(symbol, date, limit=100):
    """The `limit` most recent bars strictly BEFORE `date`, oldest-first, plus which table they
    came from: ("price_history_max" | "price_history" | None).

    Every other reader here goes forward from a date (price_history_since) or takes the newest N
    (list_price_history, price_series) - trade_context needs the window ending just before an
    entry, which is neither. price_history_max is preferred because price_history is only a
    rolling 1y window and won't reach 100 bars back for an older trade; it exists only for symbols
    where the user ran "Collect max history", hence the fallback. Returns ([], None) for a symbol
    with no local bars at all, which is normal - price_history only covers synced symbols.
    """
    sql = (
        "SELECT date, open, high, low, close, volume FROM {table} "
        "WHERE symbol = %s AND date < %s ORDER BY date DESC LIMIT %s"
    )
    with connect() as conn:
        for table in ("price_history_max", "price_history"):
            rows = conn.execute(sql.format(table=table), (symbol, date, limit)).fetchall()
            if rows:
                return list(reversed(rows)), table
    return [], None


def bars_between(symbol, start, end):
    """Bars from `start` through `end` inclusive, oldest-first - the holding window MAE/MFE needs.
    Same table preference as bars_before."""
    sql = (
        "SELECT date, open, high, low, close, volume FROM {table} "
        "WHERE symbol = %s AND date >= %s AND date <= %s ORDER BY date"
    )
    with connect() as conn:
        for table in ("price_history_max", "price_history"):
            rows = conn.execute(sql.format(table=table), (symbol, start, end)).fetchall()
            if rows:
                return rows
    return []


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
    """Symbols in list_name, or every distinct symbol across all lists when omitted - a symbol can
    belong to more than one list now, so the all-lists query must dedupe."""
    with connect() as conn:
        if list_name:
            rows = conn.execute(
                "SELECT symbol FROM watchlist WHERE list_name = %s", (list_name,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT DISTINCT symbol FROM watchlist").fetchall()
    return [r["symbol"] for r in rows]


DEFAULT_MODEL = "ollama/hf.co/empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF:Q4_K_M"


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


def get_last_event_scan_date():
    """ISO date (Asia/Kolkata) the automatic daily event scan last ran, or None if never - lets
    the scan survive a server restart without firing twice in the same day."""
    return _get_setting("last_event_scan_date")


def set_last_event_scan_date(iso_date):
    _set_setting("last_event_scan_date", iso_date)


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


DEFAULT_BROKER = "dhan"


def get_active_broker():
    return _get_setting("active_broker", DEFAULT_BROKER)


def set_active_broker(broker):
    _set_setting("active_broker", broker)


def get_dhan_credentials():
    """None if either half is missing - broker.py callers treat that as "not configured"."""
    client_id = _get_setting("dhan_client_id")
    access_token = _get_setting("dhan_access_token")
    if not client_id or not access_token:
        return None
    return {"client_id": client_id, "access_token": access_token}


def set_dhan_credentials(client_id, access_token):
    _set_setting("dhan_client_id", client_id)
    _set_setting("dhan_access_token", access_token)


def get_kite_credentials():
    """The registered app's api_key/api_secret - not a session, see get_kite_session for that."""
    api_key = _get_setting("kite_api_key")
    api_secret = _get_setting("kite_api_secret")
    if not api_key or not api_secret:
        return None
    return {"api_key": api_key, "api_secret": api_secret}


def set_kite_credentials(api_key, api_secret):
    _set_setting("kite_api_key", api_key)
    _set_setting("kite_api_secret", api_secret)


def get_kite_session():
    """None if there's no access_token, or it wasn't issued today - Kite's tokens expire at the
    next trading day's reset, so a token from a prior day is just as unusable as no token."""
    access_token = _get_setting("kite_access_token")
    issued_date = _get_setting("kite_access_token_date")
    if not access_token or issued_date != date.today().isoformat():
        return None
    return {"access_token": access_token}


def set_kite_session(access_token):
    _set_setting("kite_access_token", access_token)
    _set_setting("kite_access_token_date", date.today().isoformat())


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


def create_backtest(symbol, short_period, long_period, from_date, to_date,
                     total_return_pct, win_rate, num_trades, trades, lessons):
    with connect() as conn:
        row = conn.execute(
            "INSERT INTO backtests (symbol, short_period, long_period, from_date, to_date, "
            "total_return_pct, win_rate, num_trades, trades, lessons) VALUES "
            "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (symbol, short_period, long_period, from_date, to_date, total_return_pct, win_rate,
             num_trades, Jsonb(trades), lessons),
        ).fetchone()
    return row["id"]


def list_backtests(symbol=None):
    query = "SELECT * FROM backtests"
    params = []
    if symbol:
        query += " WHERE symbol = %s"
        params.append(symbol)
    query += " ORDER BY created_at DESC"
    with connect() as conn:
        return conn.execute(query, params).fetchall()


def latest_backtest(symbol):
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM backtests WHERE symbol = %s ORDER BY created_at DESC LIMIT 1", (symbol,)
        ).fetchone()


def delete_backtest(backtest_id):
    with connect() as conn:
        conn.execute("DELETE FROM backtests WHERE id = %s", (backtest_id,))


def update_backtest_lessons(backtest_id, lessons):
    with connect() as conn:
        conn.execute("UPDATE backtests SET lessons = %s WHERE id = %s", (lessons, backtest_id))


def create_auto_backtest_script(name, script):
    with connect() as conn:
        row = conn.execute(
            "INSERT INTO auto_backtest_scripts (name, script) VALUES (%s, %s) RETURNING id",
            (name, script),
        ).fetchone()
    return row["id"]


def list_auto_backtest_scripts():
    with connect() as conn:
        return conn.execute(
            "SELECT id, name, created_at, updated_at FROM auto_backtest_scripts ORDER BY created_at DESC"
        ).fetchall()


def get_auto_backtest_script(script_id):
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM auto_backtest_scripts WHERE id = %s", (script_id,)
        ).fetchone()


def update_auto_backtest_script(script_id, name, script):
    with connect() as conn:
        conn.execute(
            "UPDATE auto_backtest_scripts SET name = %s, script = %s, updated_at = now() WHERE id = %s",
            (name, script, script_id),
        )


def delete_auto_backtest_script(script_id):
    with connect() as conn:
        conn.execute("DELETE FROM auto_backtest_scripts WHERE id = %s", (script_id,))


def list_trade_accounts(kind="journal"):
    """Accounts of one kind - 'journal' (hand-logged) or 'paper' (live simulation). Defaults to
    journal so every existing caller keeps its current behaviour; pass kind=None for both."""
    sql = "SELECT * FROM trade_accounts"
    params = ()
    if kind is not None:
        sql += " WHERE kind = %s"
        params = (kind,)
    with connect() as conn:
        return conn.execute(sql + " ORDER BY created_at", params).fetchall()


def create_trade_account(name, strategy, strategy_explanation, opening_balance,
                          max_position_size, max_position_size_type, max_position_count,
                          kind="journal"):
    with connect() as conn:
        row = conn.execute(
            "INSERT INTO trade_accounts (name, strategy, strategy_explanation, opening_balance, "
            "max_position_size, max_position_size_type, max_position_count, kind) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (name, strategy, strategy_explanation, opening_balance, max_position_size,
             max_position_size_type, max_position_count, kind),
        ).fetchone()
    return row["id"]


def update_trade_account(account_id, name, strategy, strategy_explanation, opening_balance,
                          max_position_size, max_position_size_type, max_position_count):
    with connect() as conn:
        conn.execute(
            "UPDATE trade_accounts SET name = %s, strategy = %s, strategy_explanation = %s, "
            "opening_balance = %s, max_position_size = %s, max_position_size_type = %s, "
            "max_position_count = %s WHERE id = %s",
            (name, strategy, strategy_explanation, opening_balance, max_position_size,
             max_position_size_type, max_position_count, account_id),
        )


def delete_trade_account(account_id):
    """Trades survive - their account_id is nulled by the FK (ON DELETE SET NULL), so deleting an
    account never destroys journal history. Its deposits/withdrawals do cascade away, since they
    only ever meant anything relative to that account's wallet."""
    with connect() as conn:
        conn.execute("DELETE FROM trade_accounts WHERE id = %s", (account_id,))


# --- Paper trading positions ------------------------------------------------------------------
# Only OPEN (and resting-limit) positions live here. A fully closed one is deleted and its outcome
# written to manual_trades instead - see the paper_positions table comment.


def list_paper_positions(account_id=None):
    sql = "SELECT * FROM paper_positions"
    params = ()
    if account_id is not None:
        sql += " WHERE account_id = %s"
        params = (account_id,)
    with connect() as conn:
        return conn.execute(sql + " ORDER BY created_at DESC", params).fetchall()


def get_paper_position(position_id):
    with connect() as conn:
        return conn.execute("SELECT * FROM paper_positions WHERE id = %s", (position_id,)).fetchone()


def paper_position_symbols():
    """Distinct symbols with something to monitor - the engine's poll list. A query rather than a
    scan of every position, so an idle account costs one cheap round trip per tick."""
    with connect() as conn:
        rows = conn.execute("SELECT DISTINCT symbol FROM paper_positions").fetchall()
    return [r["symbol"] for r in rows]


def create_paper_position(account_id, symbol, direction, order_type, status, quantity, entry_price,
                          stop_losses, targets, notes=None, opened_at=None):
    with connect() as conn:
        row = conn.execute(
            "INSERT INTO paper_positions (account_id, symbol, direction, order_type, status, "
            "quantity, entry_price, stop_losses, targets, notes, opened_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (account_id, symbol, direction, order_type, status, quantity, entry_price,
             Jsonb(stop_losses or []), Jsonb(targets or []), notes, opened_at),
        ).fetchone()
    return row["id"]


def update_paper_position(position_id, **fields):
    """Partial update - only the named columns are touched. The engine uses this to shrink a
    position after a partial exit and to fill a resting limit, both of which change two or three
    columns and must leave the rest alone."""
    allowed = {"status", "quantity", "entry_price", "stop_losses", "targets", "notes", "opened_at"}
    sets, params = [], []
    for key, value in fields.items():
        if key not in allowed:
            raise ValueError(f"cannot update paper_positions.{key}")
        sets.append(f"{key} = %s")
        params.append(Jsonb(value) if key in ("stop_losses", "targets") else value)
    if not sets:
        return
    params.append(position_id)
    with connect() as conn:
        conn.execute(f"UPDATE paper_positions SET {', '.join(sets)} WHERE id = %s", params)


def delete_paper_position(position_id):
    with connect() as conn:
        conn.execute("DELETE FROM paper_positions WHERE id = %s", (position_id,))


def account_balance_at(account_id, at):
    """The account's wallet balance as of `at` (ISO string, or None for now): opening balance, plus
    every deposit/withdrawal, plus the realized P&L of every trade already closed by then.

    Called once per trade at creation time and snapshotted onto the row - see the
    account_balance_at_trade column comment for why this is never recomputed afterwards."""
    with connect() as conn:
        account = conn.execute(
            "SELECT opening_balance FROM trade_accounts WHERE id = %s", (account_id,)
        ).fetchone()
        if not account:
            return None
        row = conn.execute(
            "SELECT COALESCE(("
            "  SELECT SUM(CASE WHEN type = 'add' THEN amount ELSE -amount END) "
            "  FROM balance_adjustments WHERE account_id = %s AND adjusted_at <= COALESCE(%s, now())"
            "), 0) AS adjusted, COALESCE(("
            # Long: (exit - entry) * qty. Short: the same with the sign flipped - mirrors
            # tradePnl() in frontend/src/lib/manualTrades.js.
            "  SELECT SUM((CASE WHEN direction = 'short' THEN -1 ELSE 1 END) "
            "             * (exit_price - entry_price) * quantity) "
            "  FROM manual_trades WHERE account_id = %s AND exit_price IS NOT NULL "
            "    AND traded_at < COALESCE(%s, now())"
            "), 0) AS realized",
            (account_id, at, account_id, at),
        ).fetchone()
    return round(account["opening_balance"] + row["adjusted"] + row["realized"], 2)


def create_manual_trade(symbol, direction, quantity, entry_price, exit_price, stop_loss, target,
                         is_open, result, emotion, tags, notes, traded_at, image_filename=None,
                         setup=None, ideal_risk_amount=None, account_id=None,
                         account_balance_at_trade=None, exited_at=None, trade_context=None):
    with connect() as conn:
        row = conn.execute(
            "INSERT INTO manual_trades (symbol, direction, quantity, entry_price, exit_price, "
            "stop_loss, target, is_open, result, emotion, tags, notes, traded_at, image_filename, "
            "setup, ideal_risk_amount, account_id, account_balance_at_trade, exited_at, "
            "trade_context) VALUES "
            "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()), %s, %s, %s, %s, "
            "%s, %s, %s) "
            "RETURNING id",
            (symbol, direction, quantity, entry_price, exit_price, stop_loss, target, is_open,
             result, emotion, tags, notes, traded_at, image_filename, setup, ideal_risk_amount,
             account_id, account_balance_at_trade, exited_at,
             Jsonb(trade_context) if trade_context is not None else None),
        ).fetchone()
    return row["id"]


def list_manual_trades():
    with connect() as conn:
        return conn.execute("SELECT * FROM manual_trades ORDER BY traded_at DESC").fetchall()


def get_manual_trade(trade_id):
    with connect() as conn:
        return conn.execute("SELECT * FROM manual_trades WHERE id = %s", (trade_id,)).fetchone()


def update_manual_trade(trade_id, symbol, direction, quantity, entry_price, exit_price, stop_loss,
                         target, is_open, result, emotion, tags, notes, traded_at, setup=None,
                         ideal_risk_amount=None, account_id=None, account_balance_at_trade=None,
                         exited_at=None, trade_context=None):
    """account_balance_at_trade is COALESCEd, not overwritten with None: an ordinary edit (fixing an
    exit price, adding a tag) must leave the original snapshot alone. The caller passes a fresh
    value only when the trade actually moves to a different account - see api.update_manual_trade.

    trade_context follows the same fill-once rule for the same reason, with one difference worth
    knowing: the caller passes a value only when the stored one is still NULL. Logging a trade open
    and closing it later is ordinary, and without that the whole open-then-close workflow would
    never get MAE/MFE. Filling a blank once is still "computed once", not "recomputed on edit"."""
    with connect() as conn:
        conn.execute(
            "UPDATE manual_trades SET symbol = %s, direction = %s, quantity = %s, entry_price = %s, "
            "exit_price = %s, stop_loss = %s, target = %s, is_open = %s, result = %s, emotion = %s, "
            "tags = %s, notes = %s, traded_at = COALESCE(%s, traded_at), setup = %s, "
            "ideal_risk_amount = %s, account_id = %s, "
            "account_balance_at_trade = COALESCE(%s, account_balance_at_trade), "
            "exited_at = %s, trade_context = COALESCE(%s, trade_context) WHERE id = %s",
            (symbol, direction, quantity, entry_price, exit_price, stop_loss, target, is_open,
             result, emotion, tags, notes, traded_at, setup, ideal_risk_amount, account_id,
             account_balance_at_trade, exited_at,
             Jsonb(trade_context) if trade_context is not None else None, trade_id),
        )


def delete_manual_trade(trade_id):
    with connect() as conn:
        conn.execute("DELETE FROM manual_trades WHERE id = %s", (trade_id,))


def update_manual_trade_image(trade_id, filename):
    with connect() as conn:
        conn.execute("UPDATE manual_trades SET image_filename = %s WHERE id = %s", (filename, trade_id))


def add_activity_seconds(seconds):
    """Upserts today's row, adding to (not replacing) seconds_active - the heartbeat endpoint
    calls this every ~20s while the tab is visible, so a day's total accumulates across calls."""
    with connect() as conn:
        conn.execute(
            "INSERT INTO daily_activity (date, seconds_active) VALUES (CURRENT_DATE, %s) "
            "ON CONFLICT (date) DO UPDATE SET seconds_active = daily_activity.seconds_active + excluded.seconds_active",
            (seconds,),
        )


def ping_activity(kind):
    """kind: 'analyzed' or 'reviewed' - upserts today's row, setting that flag true. Idempotent -
    pinging twice in a day is a no-op past the first call."""
    column = "analyzed" if kind == "analyzed" else "reviewed"
    with connect() as conn:
        conn.execute(
            f"INSERT INTO daily_activity (date, {column}) VALUES (CURRENT_DATE, true) "
            f"ON CONFLICT (date) DO UPDATE SET {column} = true",
        )


def list_activity_days(days=371):
    """Ascending {date, seconds_active, analyzed, reviewed} rows for the last `days` days -
    doesn't backfill missing dates (no row = no activity that day), left to the caller."""
    with connect() as conn:
        return conn.execute(
            "SELECT date, seconds_active, analyzed, reviewed FROM daily_activity "
            "WHERE date >= CURRENT_DATE - %s::int ORDER BY date",
            (days,),
        ).fetchall()


def traded_dates(days=371):
    """Distinct dates a manual trade was logged (by creation time, not the editable traded_at) -
    the third "qualifying activity" signal, kept live off manual_trades rather than duplicated
    into daily_activity so it can never drift out of sync with the trade journal."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT DISTINCT created_at::date AS date FROM manual_trades "
            "WHERE created_at >= CURRENT_DATE - %s::int",
            (days,),
        ).fetchall()
    return {r["date"] for r in rows}


DEFAULT_ACTIVITY_QUALIFIERS = {"trade": True, "analyze": True, "review": True}
DEFAULT_ACTIVITY_DAILY_GOAL_MINUTES = 15


def get_activity_qualifiers():
    raw = _get_setting("activity_qualifiers")
    if not raw:
        return dict(DEFAULT_ACTIVITY_QUALIFIERS)
    try:
        return {**DEFAULT_ACTIVITY_QUALIFIERS, **json.loads(raw)}
    except (ValueError, TypeError):
        return dict(DEFAULT_ACTIVITY_QUALIFIERS)


def set_activity_qualifiers(qualifiers):
    _set_setting("activity_qualifiers", json.dumps(qualifiers))


def get_activity_daily_goal_minutes():
    raw = _get_setting("activity_daily_goal_minutes")
    return int(raw) if raw else DEFAULT_ACTIVITY_DAILY_GOAL_MINUTES


def set_activity_daily_goal_minutes(minutes):
    _set_setting("activity_daily_goal_minutes", str(minutes))


# --- Manual backtesting settings (setups list, risk discipline, opening balance) ---------------
DEFAULT_MANUAL_BACKTEST_SETTINGS = {
    "setups": [],
    "risk_deviation_tolerance_pct": 10,
    "opening_balance": 0,
}


def get_manual_backtest_settings():
    raw = _get_setting("manual_backtest_settings")
    if not raw:
        return dict(DEFAULT_MANUAL_BACKTEST_SETTINGS)
    try:
        return {**DEFAULT_MANUAL_BACKTEST_SETTINGS, **json.loads(raw)}
    except (ValueError, TypeError):
        return dict(DEFAULT_MANUAL_BACKTEST_SETTINGS)


def set_manual_backtest_settings(settings):
    _set_setting("manual_backtest_settings", json.dumps(settings))


# --- Trading goals (targets and limits scored against the manual-trade journal) ----------------
# One JSON blob in `settings` rather than its own table: goals are a short user-defined list
# that's always read and written whole, never joined, filtered, or queried by column. Achievement
# is never stored - it's recomputed from the trades on every read, so editing a goal (or a trade)
# can't leave a stale score behind, the same reason manual_trades doesn't persist P&L.
def get_trading_goals():
    raw = _get_setting("trading_goals")
    if not raw:
        return []
    try:
        goals = json.loads(raw)
    except (ValueError, TypeError):
        return []
    return goals if isinstance(goals, list) else []


def set_trading_goals(goals):
    _set_setting("trading_goals", json.dumps(goals))


def create_balance_adjustment(amount, adj_type, reason, notes, adjusted_at, account_id=None):
    with connect() as conn:
        row = conn.execute(
            "INSERT INTO balance_adjustments (amount, type, reason, notes, adjusted_at, account_id) "
            "VALUES (%s, %s, %s, %s, COALESCE(%s, now()), %s) RETURNING id",
            (amount, adj_type, reason, notes, adjusted_at, account_id),
        ).fetchone()
    return row["id"]


def list_balance_adjustments():
    """Every account's, unfiltered - the frontend already holds the whole list to draw the balance
    curve and filters by the selected account there, same as it does for trades."""
    with connect() as conn:
        return conn.execute("SELECT * FROM balance_adjustments ORDER BY adjusted_at DESC").fetchall()


def delete_balance_adjustment(adjustment_id):
    with connect() as conn:
        conn.execute("DELETE FROM balance_adjustments WHERE id = %s", (adjustment_id,))


def upsert_stocks_master(rows):
    """rows: list of {symbol, name, series, listing_date, isin}. Bulk upsert - re-importing a
    fresh NSE CSV just refreshes existing rows and adds new listings, never removes delisted ones."""
    if not rows:
        return
    with connect() as conn:
        conn.cursor().executemany(
            "INSERT INTO stocks_master (symbol, name, series, listing_date, isin, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, now()) ON CONFLICT (symbol) DO UPDATE SET "
            "name = excluded.name, series = excluded.series, listing_date = excluded.listing_date, "
            "isin = excluded.isin, updated_at = excluded.updated_at",
            [(r["symbol"], r["name"], r["series"], r["listing_date"], r["isin"]) for r in rows],
        )


def search_stocks_master(query="", limit=30):
    """Case-insensitive substring match on symbol, company name, or ISIN, capped at `limit`."""
    with connect() as conn:
        return conn.execute(
            "SELECT symbol, name, series, listing_date, isin FROM stocks_master "
            "WHERE symbol ILIKE %s OR name ILIKE %s OR isin ILIKE %s ORDER BY symbol LIMIT %s",
            (f"%{query}%", f"%{query}%", f"%{query}%", limit),
        ).fetchall()


def count_stocks_master():
    with connect() as conn:
        return conn.execute("SELECT count(*) AS n FROM stocks_master").fetchone()["n"]


def delete_stock_master(symbol):
    with connect() as conn:
        conn.execute("DELETE FROM stocks_master WHERE symbol = %s", (symbol,))

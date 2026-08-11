"""Self-check for the concurrent quote fan-out (app/services/quotes.paper_prices). Plain asserts,
no framework, no network and no database:

    .venv/bin/python tests/test_paper_quotes.py

The point of this function is that a page listing N positions makes ONE round trip's worth of
calls rather than N sequential ones, and that a single bad symbol can't take the others down with
it - so that's what's checked, by swapping the per-symbol lookup for a slow fake.
"""
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

# Run as a script, so the repo root has to go on sys.path before importing app.* - the package
# is not installed, it just sits at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import quotes

DELAY = 0.2


def slow_price(symbol):
    """Stands in for a real quote call: takes DELAY, and one symbol is permanently broken."""
    time.sleep(DELAY)
    if symbol == "BROKEN":
        return None
    return 100.0 + len(symbol)


def test_fetches_concurrently_not_one_at_a_time():
    symbols = [f"SYM{i}" for i in range(8)]
    with patch.object(quotes, "paper_price", slow_price):
        started = time.monotonic()
        out = quotes.paper_prices(symbols)
        elapsed = time.monotonic() - started

    assert set(out) == set(symbols), out
    # Sequentially this would be 8 * DELAY. Allow generous headroom for scheduling - the assertion
    # only has to fail if the calls went back to running one after another.
    assert elapsed < DELAY * 4, f"took {elapsed:.2f}s for 8 symbols - looks sequential"


def test_one_dead_symbol_does_not_sink_the_rest():
    with patch.object(quotes, "paper_price", slow_price):
        out = quotes.paper_prices(["TCS", "BROKEN", "INFY"])
    assert out["BROKEN"] is None
    assert out["TCS"] is not None and out["INFY"] is not None, out


def test_repeated_symbols_are_fetched_once():
    calls = []
    lock = threading.Lock()

    def counting(symbol):
        with lock:
            calls.append(symbol)
        return 1.0

    with patch.object(quotes, "paper_price", counting):
        out = quotes.paper_prices(["TCS", "TCS", "INFY", "TCS"])
    assert calls.count("TCS") == 1, calls
    assert out == {"TCS": 1.0, "INFY": 1.0}, out


def test_empty_input_makes_no_calls():
    # A guard that matters: ThreadPoolExecutor(max_workers=0) raises, so the empty case must
    # short-circuit before the pool is built.
    with patch.object(quotes, "paper_price", lambda s: 1.0):
        assert quotes.paper_prices([]) == {}


def test_pool_is_bounded():
    """Concurrency must stay capped - fanning out over an unbounded number of symbols would just
    move the rate-limiting problem rather than solve it."""
    live = 0
    peak = 0
    lock = threading.Lock()

    def tracked(symbol):
        nonlocal live, peak
        with lock:
            live += 1
            peak = max(peak, live)
        time.sleep(0.05)
        with lock:
            live -= 1
        return 1.0

    with patch.object(quotes, "paper_price", tracked):
        quotes.paper_prices([f"S{i}" for i in range(40)])
    assert peak <= quotes.MAX_QUOTE_WORKERS, f"peak concurrency {peak} exceeded the cap"


def _stored(minutes_old, price=100.0):
    return {"price": price, "fetched_at": datetime.now(timezone.utc) - timedelta(minutes=minutes_old)}


def test_fresh_stored_price_is_served_without_fetching():
    with (
        patch.object(quotes.db, "get_paper_prices", lambda s: {"TCS": _stored(0)}),
        patch.object(quotes, "paper_price", slow_price),
    ):
        started = time.monotonic()
        out = quotes.paper_quotes(["TCS"])
        elapsed = time.monotonic() - started

    assert out["TCS"]["price"] == 100.0
    assert out["TCS"]["stale"] is False
    assert elapsed < DELAY, f"took {elapsed:.2f}s - it waited on a quote it already had"


def test_stale_price_is_still_served_and_refreshed_in_background():
    """The whole point: an old price goes out *now* (flagged stale so the UI can show its loader)
    while the refetch happens off the request path."""
    refreshed = threading.Event()

    def refetch(symbol):
        time.sleep(DELAY)
        refreshed.set()
        return 123.0

    with (
        patch.object(quotes.db, "get_paper_prices", lambda s: {"TCS": _stored(30)}),
        patch.object(quotes, "paper_price", refetch),
    ):
        started = time.monotonic()
        out = quotes.paper_quotes(["TCS"])
        elapsed = time.monotonic() - started

        assert out["TCS"]["price"] == 100.0, "served the refetched price instead of the stored one"
        assert out["TCS"]["stale"] is True
        assert elapsed < DELAY, f"took {elapsed:.2f}s - the refresh blocked the response"
        assert refreshed.wait(DELAY * 10), "stale symbol was never refreshed"


def test_never_quoted_symbol_is_fetched_inline():
    # No stored row means nothing to fall back on, so this one has to block - otherwise a
    # first-ever load shows an empty column. Stands in for the real table: paper_price writes,
    # paper_quotes reads back.
    table = {}

    def fetch_and_store(symbol):
        price = slow_price(symbol)
        if price is not None:
            table[symbol] = {
                "price": price,
                "sector": "Technology",
                "fetched_at": datetime.now(timezone.utc),
            }
        return price

    with (
        patch.object(quotes.db, "get_paper_prices", lambda s: {k: table[k] for k in s if k in table}),
        patch.object(quotes, "paper_price", fetch_and_store),
    ):
        out = quotes.paper_quotes(["TCS", "BROKEN"])
    assert out["TCS"]["price"] == 103.0, out
    assert out["TCS"]["sector"] == "Technology", out
    assert out["BROKEN"] is None, "a symbol with no price at all must be None, not a fake 0"


def test_refresh_is_not_queued_twice_for_the_same_symbol():
    calls = []
    lock = threading.Lock()
    release = threading.Event()

    def blocking(symbol):
        with lock:
            calls.append(symbol)
        release.wait(2)
        return 1.0

    with (
        patch.object(quotes.db, "get_paper_prices", lambda s: {"TCS": _stored(30)}),
        patch.object(quotes, "paper_price", blocking),
    ):
        for _ in range(5):
            quotes.paper_quotes(["TCS"])
        time.sleep(0.1)
        assert calls == ["TCS"], f"queued {len(calls)} refreshes for one in-flight symbol"
        release.set()


if __name__ == "__main__":
    test_fetches_concurrently_not_one_at_a_time()
    test_one_dead_symbol_does_not_sink_the_rest()
    test_repeated_symbols_are_fetched_once()
    test_empty_input_makes_no_calls()
    test_pool_is_bounded()
    test_fresh_stored_price_is_served_without_fetching()
    test_stale_price_is_still_served_and_refreshed_in_background()
    test_never_quoted_symbol_is_fetched_inline()
    test_refresh_is_not_queued_twice_for_the_same_symbol()
    print("all checks passed")

"""Self-check for price_history sync: backfill, incremental gap-fill, idempotency, EMA crossover."""
from datetime import date, timedelta

import db
import prices
import scraper

SYMBOL = "ZZZPRICETEST"


def _bar(d, close):
    return {"date": d.isoformat(), "open": close, "high": close, "low": close, "close": close, "volume": 1000}


def test_sync_backfills_then_gap_fills_then_dedups():
    db.init_schema()
    calls = []

    def fake_bars(symbol, start=None):
        calls.append(start)
        if start is None:  # first sync: backfill - return 3 days
            base = date(2026, 1, 1)
            return [_bar(base + timedelta(days=i), 100 + i) for i in range(3)]
        return []  # gap-fill call: nothing new today

    scraper.get_daily_bars = fake_bars
    try:
        assert db.latest_price_date(SYMBOL) is None
        assert prices.sync_symbol(SYMBOL) == 3          # backfill inserted 3 bars
        assert db.latest_price_date(SYMBOL) == date(2026, 1, 3)
        assert calls[0] is None                          # first call was a full backfill, not a gap-fill

        assert prices.sync_symbol(SYMBOL) == 0            # second sync: gap-fill only, nothing new
        assert calls[1] == "2026-01-04"                   # started the day after the latest stored bar

        prices.sync_symbol(SYMBOL)                        # re-run again: idempotent, no duplicate rows
        rows = db.list_price_history(SYMBOL, days=10)
        assert len(rows) == 3
    finally:
        with db.connect() as conn:
            conn.execute("DELETE FROM price_history WHERE symbol = %s", (SYMBOL,))


def test_ema_crossover_needs_enough_history():
    db.init_schema()
    try:
        db.insert_price_bars(SYMBOL, [_bar(date(2026, 1, 1) + timedelta(days=i), 100) for i in range(5)])
        assert prices.ema_crossover(SYMBOL, short=20, long=50) is None  # not enough bars yet

        # 60 rising closes: short EMA(20) should end up above long EMA(50) - a bullish setup
        with db.connect() as conn:
            conn.execute("DELETE FROM price_history WHERE symbol = %s", (SYMBOL,))
        bars = [_bar(date(2026, 1, 1) + timedelta(days=i), 100 + i) for i in range(60)]
        db.insert_price_bars(SYMBOL, bars)
        signal = prices.ema_crossover(SYMBOL, short=20, long=50)
        assert signal is not None
        assert signal["shortEma"] > signal["longEma"]
    finally:
        with db.connect() as conn:
            conn.execute("DELETE FROM price_history WHERE symbol = %s", (SYMBOL,))


def test_chart_from_history_respects_coverage():
    db.init_schema()
    try:
        assert prices.chart_from_history(SYMBOL, "1d") is None    # intraday - never DB-servable
        assert prices.chart_from_history(SYMBOL, "1mo") is None   # no history stored yet

        # only 10 days stored - not enough warmup for "1mo" (needs 30 + 120 warmup days back)
        db.insert_price_bars(SYMBOL, [_bar(date.today() - timedelta(days=i), 100 + i) for i in range(10)])
        assert prices.chart_from_history(SYMBOL, "1mo") is None

        # a full year stored - "1mo" is now covered, should build real bars from the DB
        db.insert_price_bars(SYMBOL, [_bar(date.today() - timedelta(days=i), 100 + i) for i in range(365)])
        chart = prices.chart_from_history(SYMBOL, "1mo")
        assert chart is not None
        assert chart["interval"] == "1d"
        assert len(chart["bars"]) > 0
    finally:
        with db.connect() as conn:
            conn.execute("DELETE FROM price_history WHERE symbol = %s", (SYMBOL,))


def test_collect_max_history_is_separate_from_price_history():
    db.init_schema()

    def fake_max_bars(symbol, start=None, period="1y"):
        assert period == "max"  # collect_max_history must request the full range, not the 1y default
        return [_bar(date(2000, 1, 1) + timedelta(days=i), 100 + i) for i in range(3)]

    scraper.get_daily_bars = fake_max_bars
    try:
        assert db.has_max_history(SYMBOL) is False
        assert prices.collect_max_history(SYMBOL) == 3
        assert db.has_max_history(SYMBOL) is True
        assert len(db.list_max_history(SYMBOL)) == 3
        assert db.list_price_history(SYMBOL) == []  # price_history is untouched by a max collect
    finally:
        with db.connect() as conn:
            conn.execute("DELETE FROM price_history_max WHERE symbol = %s", (SYMBOL,))


if __name__ == "__main__":
    test_sync_backfills_then_gap_fills_then_dedups()
    test_ema_crossover_needs_enough_history()
    test_chart_from_history_respects_coverage()
    test_collect_max_history_is_separate_from_price_history()
    print("all checks passed")

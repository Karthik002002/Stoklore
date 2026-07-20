"""Self-check for the watchlist event scan: all 4 event types insert once, re-scan inserts zero."""
from datetime import datetime, timezone

import db
import events
import scraper
import sentiment

SYMBOL = "ZZZEVENTTEST"


def _stub(monkeypatch=None):
    """Stubs network scrapers and the sentiment model with canned data (no downloads, no HTTP)."""
    scraper.get_news = lambda symbol: [{
        "title": "Test headline", "summary": "Test summary",
        "url": "https://example.com/a1", "published_at": datetime.now(timezone.utc),
    }]
    scraper.get_quote = lambda symbol: {
        "regularMarketChangePercent": 7.5,       # above movement's 5% threshold
        "regularMarketVolume": 5000, "averageVolume": 1000,  # above volume's 2x threshold
    }
    scraper.get_corporate_actions = lambda symbol, since_days=30: [
        {"action_type": "dividend", "date": "2026-07-15", "detail": "Dividend of ₹12 per share"},
    ]
    sentiment.analyze = lambda text: {"label": "positive", "score": 0.99}


def test_scan_symbol_inserts_then_dedups():
    db.init_schema()
    _stub()
    try:
        assert events.scan_symbol(SYMBOL) == 4  # news + price_move + volume_spike + corporate_action
        assert events.scan_symbol(SYMBOL) == 0  # identical re-scan: every dedup key already exists
        types = {e["event_type"] for e in db.list_events(symbol=SYMBOL)}
        assert types == {"news", "price_move", "volume_spike", "corporate_action"}
    finally:
        with db.connect() as conn:
            conn.execute("DELETE FROM stock_events WHERE symbol = %s", (SYMBOL,))


if __name__ == "__main__":
    test_scan_symbol_inserts_then_dedups()
    print("all checks passed")

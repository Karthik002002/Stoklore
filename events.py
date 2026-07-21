"""Scans watchlisted symbols for news/price/volume/corporate-action events - no LLM, cheap+fast."""
from datetime import date

import db
import scraper
import sentiment
import skills

_movement = skills.load_skill("movement")  # reuse |%change| >= 5 threshold
_volume = skills.load_skill("volume")      # reuse volume >= 2x avg threshold


def scan_symbol(symbol):
    """Returns count of new events inserted for one symbol. Lets exceptions propagate -
    scan() isolates failures per-symbol."""
    inserted = 0

    for item in scraper.get_news(symbol):
        if not item["url"]:
            continue
        score = sentiment.analyze(f"{item['title']}. {item['summary']}")
        if db.insert_event(symbol, "news", item["url"], item["title"], item["summary"],
                           item["url"], item["published_at"], score["label"], score["score"]):
            inserted += 1

    quote = scraper.get_quote(symbol)
    today = date.today().isoformat()
    change = quote.get("regularMarketChangePercent")
    if change is not None and _movement([{"changePercent": change}]):
        headline = f"{symbol} moved {change:+.1f}% today"
        if db.insert_event(symbol, "price_move", today, headline, None, None, today, None, None):
            inserted += 1
    vol, avg_vol = quote.get("regularMarketVolume"), quote.get("averageVolume")
    if vol and avg_vol and _volume([{"volume": vol, "avgVolume": avg_vol}]):
        headline = f"{symbol} trading at {vol:,} vs {avg_vol:,} average volume"
        if db.insert_event(symbol, "volume_spike", today, headline, None, None, today, None, None):
            inserted += 1

    for action in scraper.get_corporate_actions(symbol):
        if db.insert_event(symbol, "corporate_action", f"{action['action_type']}:{action['date']}",
                           action["detail"], None, None, action["date"], None, None):
            inserted += 1

    return inserted


def scan(list_name=None, on_progress=None):
    """Scans every watchlisted symbol (or one list's). on_progress(done, total) mirrors
    main.scan's callback shape so api.py can reuse its progress-polling pattern."""
    symbols = db.watchlist_symbols(list_name)
    count = 0
    for i, symbol in enumerate(symbols, 1):
        try:
            count += scan_symbol(symbol)
        except Exception as e:
            print(f"skipped {symbol}: {e}")
        if on_progress:
            on_progress(i, len(symbols))
    return count

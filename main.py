"""CLI: scan NSE India movers, filter via skills, analyze with local llama3.1, store in Postgres."""
import argparse

import db
import llm
import scraper
import skills


def analyze_ticker(symbol, model):
    """Scrapes, analyzes, and stores one ticker. Returns False without doing any work if a
    report already exists from within the last 24h - avoids redundant scrape+LLM+embed calls."""
    if db.has_recent_item(symbol):
        return False
    news = scraper.get_news(symbol)
    financials = scraper.get_financials(symbol)
    markdown = llm.build_markdown(symbol, financials, news, model=model)
    db.insert_scraped_item(symbol, markdown, llm.embed(markdown))
    return True


def scan(skill_names, limit, model, watchlist=None, on_progress=None):
    """on_progress(done, total), if given, is called after each ticker - lets a caller (e.g. the
    API's background scan) report live progress without polling the DB."""
    if watchlist is not None:
        # watchlist scan: analyze saved symbols directly - mover skills don't apply
        tickers = [{"symbol": s} for s in db.watchlist_symbols(watchlist or None)]
    else:
        tickers = scraper.get_movers()
        for name in skill_names:
            tickers = skills.load_skill(name)(tickers)
    tickers = tickers[:limit]

    count = 0
    for i, t in enumerate(tickers, 1):
        try:
            if analyze_ticker(t["symbol"], model):
                print(f"analyzed {t['symbol']}")
                count += 1
            else:
                print(f"skipped {t['symbol']}: already analyzed within 24h")
        except Exception as e:
            print(f"skipped {t['symbol']}: {e}")
        if on_progress:
            on_progress(i, len(tickers))
    return count


def main():
    parser = argparse.ArgumentParser(description="Scan stock movers, analyze with local LLM, store in Postgres.")
    parser.add_argument("--skills", default="movement,volume", help=f"comma list, available: {skills.available_skills()}")
    parser.add_argument("--limit", type=int, default=10, help="max tickers to analyze")
    parser.add_argument("--model", default=None, help="e.g. ollama/llama3.1 or an OmniRoute model id; defaults to the active model set in Settings")
    parser.add_argument("--watchlist", nargs="?", const="", default=None, metavar="LIST",
                        help="scan saved watchlist symbols instead of movers; optionally a single list name")
    args = parser.parse_args()

    db.init_schema()
    db.purge_old(days=14)
    model = args.model or db.get_active_model()
    count = scan(args.skills.split(","), args.limit, model, watchlist=args.watchlist)
    print(f"stored {count} reports" if count else "no tickers matched the given skills")


if __name__ == "__main__":
    main()

"""CLI: scan NSE India movers, filter via skills, analyze with local llama3.1, store in Postgres."""
import argparse

import db
import llm
import scraper
import skills


def scan(skill_names, limit):
    tickers = scraper.get_movers()
    for name in skill_names:
        tickers = skills.load_skill(name)(tickers)
    tickers = tickers[:limit]

    count = 0
    for t in tickers:
        news = scraper.get_news(t["symbol"])
        financials = scraper.get_financials(t["symbol"])
        markdown = llm.build_markdown(t["symbol"], financials, news)
        embedding = llm.embed(markdown)
        db.insert_scraped_item(t["symbol"], markdown, embedding)
        print(f"analyzed {t['symbol']}")
        count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description="Scan stock movers, analyze with local LLM, store in Postgres.")
    parser.add_argument("--skills", default="movement,volume", help=f"comma list, available: {skills.available_skills()}")
    parser.add_argument("--limit", type=int, default=10, help="max tickers to analyze")
    args = parser.parse_args()

    db.init_schema()
    db.purge_old(days=14)
    count = scan(args.skills.split(","), args.limit)
    print(f"stored {count} reports" if count else "no tickers matched the given skills")


if __name__ == "__main__":
    main()

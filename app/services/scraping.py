"""On-demand scrape/analyze helpers shared by the chat agent, the sentiment endpoint and
the stock-detail routes."""
from datetime import datetime, timezone

import requests
from fastapi import HTTPException

import db
import llm
import scraper
import sentiment

def _embed_or_none(markdown):
    """Embeddings always need local Ollama regardless of the active chat model - if it's not
    running, the report itself (already scraped/generated) shouldn't be thrown away over it, just
    stored without a vector (skips similarity_search, everything else about it still works)."""
    try:
        return llm.embed(markdown)
    except RuntimeError:
        return None


def _live_scrape(symbol, model):
    """Scrapes+analyzes a symbol on demand from the user's prompt and caches it like a normal
    scan. Reuses the existing report instead of re-scraping if one was made within the last 24h -
    matters a lot for chat, where the same ticker can be mentioned across many turns."""
    if db.has_recent_item(symbol):
        return db.latest_item_markdown(symbol)
    news = scraper.get_news(symbol)
    financials = scraper.get_financials(symbol)
    if not news and not financials.get("sector"):
        return None
    markdown = llm.build_markdown(symbol, financials, news, model=model)
    db.insert_scraped_item(symbol, markdown, _embed_or_none(markdown))
    return markdown


def _analyze_url(url, model):
    """Scrapes an arbitrary news/blog URL, finds which NSE stocks it's about, and scores its
    sentiment with the local FinRoBERTa model. Whole-article sentiment, not per-ticker - fine for
    single-company articles; multi-company articles with opposing sentiment need per-snippet
    scoring, which isn't implemented yet."""
    try:
        article = scraper.scrape_article(url)
    except requests.RequestException as e:
        raise RuntimeError(f"Couldn't fetch that URL: {e}") from e
    if not article["text"]:
        raise HTTPException(status_code=422, detail="Couldn't extract article text from that URL")
    tickers = llm.extract_tickers(article["text"], model)
    score = sentiment.analyze(article["text"])
    reasoning = llm.explain_sentiment(article["text"], score["label"], model)
    return {"title": article["title"], "url": url, "tickers": tickers, "sentiment": score, "reasoning": reasoning}


def _cached_news(symbol):
    """Serves news from Postgres if scraped within the last day, otherwise re-scrapes and refreshes it.
    Merges in Cogencis news (Settings > Cogencis) when a token is configured - it's keyed by ISIN
    rather than NSE symbol and often surfaces different sources than yfinance, so both are kept
    (deduped by url) rather than one replacing the other."""
    cached = db.get_cached_news(symbol)
    if cached is not None:
        return cached
    try:
        fresh = scraper.get_news(symbol)
    except Exception:
        fresh = []

    token = db.get_cogencis_token()
    if token:
        try:
            isin = scraper.get_isin(symbol)
            if isin:
                fresh += scraper.get_cogencis_news(isin, token)
        except Exception:
            pass  # token likely expired/invalid - yfinance news still shown

    seen_urls = set()
    deduped = []
    for item in fresh:
        if item["url"] and item["url"] in seen_urls:
            continue
        seen_urls.add(item["url"])
        deduped.append(item)
    deduped.sort(key=lambda i: i["published_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    fresh = deduped

    for item in fresh:
        try:
            score = sentiment.analyze(f"{item['title']}. {item['summary']}")
            item["sentiment_label"], item["sentiment_score"] = score["label"], score["score"]
        except Exception:
            pass
    db.save_news(symbol, fresh)
    return fresh

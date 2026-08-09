"""Domain and infrastructure layer: everything the HTTP layer sits on top of.

Postgres access (db), price/news/fundamentals fetching (scraper, netfetch, prices, minute_data,
price_sources, moneycontrol_local), broker clients (broker, kite), the LLM client (llm), and the
pure engines (rules, backtest, paper, trade_context, sentiment, events, stocks_master, backup).

Nothing here imports app.routers or app.services - the dependency runs one way, so an engine can
be exercised from a test or the CLI (app/cli.py) without standing up FastAPI. `app/core/config.py`
holds the cross-cutting constants these share.
"""

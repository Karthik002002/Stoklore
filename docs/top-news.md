# Top News

[← Back to index](README.md)

## Using it

- `/top-news` — Cogencis's general market feed, refreshed every 24h
  (**Reload** bypasses the cache).
- Toggle **"Affecting my watchlist only"** to filter to stories tagged with
  a symbol you track.

## How it works

`GET /api/top-news` caches the *whole feed* for 24 hours (not per-story) —
on a cold cache it paginates 5 pages of 20 stories from Cogencis (the
latest 100), 2 seconds apart to stay polite to their API. `force=true`
(the Reload button) skips the cache check and re-scrapes immediately.

**Watchlist tagging happens fresh on every single call, even for cached
stories.** Each Cogencis story comes back with an `isins` field (a
comma-separated list like `"INE099Z01011 MISHDHAT.BS MISHDHAT.NS,
INE258A01016 BEML.BS BEML.NS"`); the endpoint extracts just the ISIN codes
from that, builds a `{ISIN: your_symbol}` map from your *current*
watchlist (looking up each symbol's ISIN once, permanently cached — an
ISIN never changes for a listed security, so it's the one live yfinance
call per symbol you'll ever pay), and matches. That's why adding or
removing a stock from your watchlist changes which stories show
`affected_symbols` immediately, without needing to wait for the 24h cache
to expire — the expensive part (the news itself) is cached, the cheap part
(which of your stocks it touches) never is.

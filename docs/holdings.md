# Holdings

[← Back to index](README.md)

## Using it

- `/holdings` — read-only mirror of your actual broker account, no order
  placement.
- Switch broker (Dhan/Kite) from the logo dropdown.
- If the active broker isn't configured yet, click **Configure** — it jumps
  straight to the right Settings → Broker sub-tab.
- Kite needs a same-day login: click **Connect to Kite** in Settings, it
  redirects back automatically once you approve.
- Ask the chat agent "how is my portfolio doing" for the same data without
  leaving chat.

## How it works

**Two brokers, two auth models.** Dhan is a static client-id + long-lived
access-token pair sent as plain headers — no login flow. Kite is a genuine
daily OAuth-like dance: Settings' "Connect to Kite" opens Kite's own login
page; on success it redirects to `GET /api/kite/callback` with a
`request_token`, which the backend exchanges for a day-valid `access_token`
by computing `sha256(api_key + request_token + api_secret)` as a checksum
and posting it to Kite's session endpoint. That token is stored and reused
until it expires (Kite Connect never issues long-lived tokens, so this
happens again the next trading day).

**Both brokers' raw API responses get normalized into one shared shape**
(`{available_balance, holdings: [{symbol, isin, qty, avg_price, ...}]}`)
independently, inside `broker.py`/`kite.py` themselves — the endpoint that
serves `/api/holdings` doesn't know or care which broker it's talking to
beyond picking which client to call; it never branches on response shape.

**Current price** is where the two brokers genuinely differ: Dhan's live
price feed is a separately-paid plan, so its holdings are filled in from
this app's *own* price cache (the same 15-minute-TTL yfinance cache the
dashboard uses) rather than anything from Dhan itself. Kite's holdings
response already includes a live `last_price` per position for free, so
that's used directly and the cache is only a fallback for whatever's
missing.

**The whole holdings snapshot is cached for 5 minutes** (shorter than the
15-minute price TTL, since it's money you're actually watching) — a manual
reload on the page bypasses it the same way Dashboard's Reload bypasses the
price cache.

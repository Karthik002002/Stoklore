# Scraping & Anti-Block Transport

[← Back to index](README.md)

Every outbound scrape in this app goes through one module, `netfetch.py`. Nothing
in `scraper.py`, `moneycontrol_local.py`, or `price_sources/` calls
`requests.get` directly any more — so the "don't get blocked" behaviour is
configured in one place instead of being re-derived at each call site.

**Not routed through it, on purpose:** `broker.py` and `kite.py`. Those are
authenticated Dhan/Kite APIs accessed with your own API keys — official access,
no bot detection to get past. Throttling or impersonating there would be wrong
and could break auth.

## Configuration

All optional; the defaults work with no proxy at all.

| Variable | Default | Meaning |
|---|---|---|
| `SCRAPER_PROXIES` | *(none)* | Comma-separated proxy URLs to rotate through. Empty = direct connection. |
| `SCRAPER_IMPERSONATE` | `chrome` | Browser profile to impersonate (TLS/JA3 + HTTP2 fingerprint). |
| `SCRAPER_MIN_INTERVAL` | `1.0` | Minimum seconds between two requests **to the same host**. |
| `SCRAPER_JITTER` | `0.75` | Max extra random delay added on top, so the cadence isn't a flat heartbeat. |
| `SCRAPER_MAX_RETRIES` | `3` | Attempts before giving up. |
| `SCRAPER_MAX_BACKOFF` | `30` | Ceiling on any single backoff wait, including a server's `Retry-After`. |
| `SCRAPER_SESSION_MAX_USES` | `40` | Requests per cookie jar before it's retired and the fingerprint re-rolled. |
| `SCRAPER_TIMEOUT` | `20` | Per-request timeout in seconds. |

Example — residential proxies, and a gentler crawl:

```bash
export SCRAPER_PROXIES="http://user:pass@resi1.example:8000,http://user:pass@resi2.example:8000"
export SCRAPER_MIN_INTERVAL=2.5
```

## The layers, and who implements each

Most of this is **not hand-rolled** — `scrapling` (already a dependency) does the
hard parts, and `netfetch.py` configures it and adds the parts a library can't
decide for you.

**Browser TLS/JA3 + HTTP2 fingerprint** — `scrapling`'s `impersonate`
(`curl_cffi` underneath). This is the layer that matters most on protected
sites: a plain `requests` call has a Python-shaped TLS handshake that Cloudflare
and Akamai flag *before reading a single header*, which is why header-only
tricks stop working. yfinance 1.5.1 already uses `curl_cffi` internally, so
Yahoo calls have browser TLS out of the box.

**Coherent browser headers** — `scrapling`'s `stealthy_headers=True` generates a
full, self-consistent set per request (User-Agent, `Accept*`, `Sec-Ch-Ua`, and a
plausible Google `Referer`). Note the app deliberately does *not* hand-roll
User-Agent rotation on top: a Chrome UA paired with Firefox's `Accept` header is
a **stronger** bot signal than a boring, honest one. Coherence beats randomness.
This is also why the pinned `User-Agent` strings were removed from the Cogencis
and moneycontrol header dicts — they now carry only their endpoint-specific bits
(`Origin`, `Referer`, `Accept`, auth) and inherit the rest.

**Proxy rotation** — `scrapling`'s `ProxyRotator`, fed from `SCRAPER_PROXIES`.
Prefer residential/mobile endpoints: datacenter ranges (AWS, DigitalOcean,
Hetzner) get blocked wholesale by anti-bot vendors, so a cheap datacenter proxy
is often *worse* than no proxy.

**Session rotation** — one pooled cookie jar per site (`pool="nse"`,
`pool="cogencis"`, …), reused so priming cookies survive, then retired after
`SCRAPER_SESSION_MAX_USES`. Pools are isolated, so fetching screener.in can't
rotate NSE's cookies out mid-flow.

**The human funnel** — `request(..., prime=NSE_BASE)` fetches a site's homepage
on a fresh session before hitting a deep JSON endpoint. NSE genuinely requires
this (it hands out edge cookies on the homepage and `403`s API calls without
them); it also happens to be what a real visitor's request order looks like.

**Politeness throttle + jitter** — per-host, implemented in `netfetch`. Per-host
so a screener.in fetch doesn't make an unrelated NSE call wait.

**429-aware backoff** — exponential (1s, 2s, 4s…) with jitter, but a server's own
`Retry-After` wins when present. Retries cover `429`, `5xx`, and `403` — the
last because these sites serve 403 from their bot-detection edge rather than as
a real auth failure, and a fresh session often clears it. The session is rotated
between attempts, since a block is about *that* identity and retrying on the
same cookies mostly wastes the attempt.

## On not getting banned in the first place

The throttle and the backoff matter more than any fingerprinting trick. Scraping
faster than a human plausibly browses is what gets an IP banned, and it's also
what actually costs the target site money. The defaults here are deliberately
unhurried, and the app's own DB caching (`db.get_cached` / `api._cached`) means
most of these calls never leave the process at all — raising
`SCRAPER_MIN_INTERVAL` is nearly free, so prefer that over reaching for more
proxies.

If a site starts serving interstitials to the current fingerprint,
`netfetch.reset_sessions()` drops every pooled session and its cookies.

"""Shared outbound HTTP for every scrape in this app - anti-block transport, one place.

Every fetch in scraper.py (and price_sources/) goes through here instead of calling requests.get
directly, so the "don't look like a bot" behaviour is configured once rather than re-derived at
each call site. What it does, and who actually implements it:

  * Browser TLS/JA3 + HTTP2 fingerprint - scrapling's `impersonate` (curl_cffi under the hood).
    A plain `requests` call has a Python-shaped TLS handshake that Cloudflare/Akamai flag before
    a single header is read, which is why header-only tricks stop working on protected sites.
  * Real browser headers (User-Agent, Accept*, Sec-Ch-Ua, and a plausible Referer) - scrapling's
    `stealthy_headers=True` generates a coherent set per request. Coherent matters: a Chrome UA
    with Firefox's Accept header is a stronger bot signal than a boring UA would have been, so
    this deliberately does NOT hand-roll UA rotation on top of it.
  * Residential/rotating proxy support - scrapling's ProxyRotator, fed from $SCRAPER_PROXIES.
  * Session rotation - cookie jars are recycled (see _SESSION_MAX_USES) rather than one jar
    serving thousands of requests, and each rotation re-rolls the fingerprint.
  * Politeness throttle + jitter, and 429-aware exponential backoff - implemented here, since
    the point is to send FEWER requests, which no library can decide on your behalf.

On being a good citizen: the throttle and the backoff are the parts that matter most. Scraping
faster than a human plausibly browses is what gets an IP banned, and it is also what actually
costs the site money. Defaults here are deliberately unhurried; the app's own DB caching layer
(db.get_cached / api._cached) means most of these calls never leave the process anyway.
"""
import os
import random
import threading
import time
from urllib.parse import urlparse

from scrapling.fetchers import FetcherSession
from scrapling.engines.toolbelt.proxy_rotation import ProxyRotator

# Comma-separated proxy URLs, e.g.
#   SCRAPER_PROXIES="http://user:pass@residential1:8000,http://user:pass@residential2:8000"
# Datacenter proxies (AWS/DO/Hetzner ranges) are routinely blocked wholesale by anti-bot vendors,
# so residential/mobile endpoints are what this is meant for. Empty = direct connection.
PROXIES = [p.strip() for p in os.environ.get("SCRAPER_PROXIES", "").split(",") if p.strip()]
IMPERSONATE = os.environ.get("SCRAPER_IMPERSONATE", "chrome")
# Minimum gap between two requests to the SAME host. Per-host so hitting screener.in doesn't
# make an unrelated NSE call wait.
MIN_INTERVAL = float(os.environ.get("SCRAPER_MIN_INTERVAL", "1.0"))
# Random extra delay on top, so the request cadence isn't a perfectly flat 1.000s heartbeat.
JITTER = float(os.environ.get("SCRAPER_JITTER", "0.75"))
MAX_RETRIES = int(os.environ.get("SCRAPER_MAX_RETRIES", "3"))
TIMEOUT = int(os.environ.get("SCRAPER_TIMEOUT", "20"))
# Cap on how long a Retry-After will actually be honoured before giving up instead of blocking a
# request thread for minutes.
MAX_BACKOFF = float(os.environ.get("SCRAPER_MAX_BACKOFF", "30"))

_ROTATOR = ProxyRotator(PROXIES) if PROXIES else None

_throttle_lock = threading.Lock()
_last_request_at = {}  # host -> monotonic timestamp of the last request sent


def _throttle(url):
    """Block until this host's politeness interval has elapsed, then jitter.

    Held under one short lock so concurrent scrape threads (api.py runs several) queue behind each
    other for the same host instead of all firing at once the moment the interval passes."""
    host = urlparse(url).netloc
    with _throttle_lock:
        wait = MIN_INTERVAL - (time.monotonic() - _last_request_at.get(host, 0.0))
        if wait > 0:
            time.sleep(wait)
        if JITTER:
            time.sleep(random.uniform(0, JITTER))
        _last_request_at[host] = time.monotonic()


def _retry_after_seconds(response):
    """Honour a server's own Retry-After when it sends one - it is the site telling you exactly
    how long to wait, and ignoring it is what turns a soft rate-limit into a hard ban. Only the
    delta-seconds form is handled; the HTTP-date form falls back to our own backoff."""
    raw = (getattr(response, "headers", None) or {}).get("Retry-After")
    try:
        return min(float(raw), MAX_BACKOFF) if raw else None
    except (TypeError, ValueError):
        return None


# --- session pool ------------------------------------------------------------------------------
# One live FetcherSession per pool key, reused so cookies set by a priming request (NSE hands out
# a bm_sv/nsit cookie on its homepage and 403s API calls without it) survive across calls - then
# retired after _SESSION_MAX_USES so no single cookie jar / fingerprint accumulates a long,
# obviously-robotic history.
_SESSION_MAX_USES = int(os.environ.get("SCRAPER_SESSION_MAX_USES", "40"))
_sessions = {}  # key -> [session, uses]
_session_lock = threading.Lock()


def _new_session():
    session = FetcherSession(
        impersonate=IMPERSONATE,
        stealthy_headers=True,
        timeout=TIMEOUT,
        proxy_rotator=_ROTATOR,
        # scrapling's own retry covers transport errors; status-code retries are handled in
        # request() below, where Retry-After can actually be read off the response.
        retries=1,
    )
    return session.__enter__()


def _get_session(key):
    with _session_lock:
        entry = _sessions.get(key)
        if entry is None or entry[1] >= _SESSION_MAX_USES:
            if entry is not None:
                try:
                    entry[0].__exit__(None, None, None)
                except Exception:
                    pass
            entry = [_new_session(), 0]
            _sessions[key] = entry
        entry[1] += 1
        return entry[0]


def reset_sessions():
    """Drop every pooled session (and its cookies). Called after a hard block, and useful from a
    REPL when a site has started serving interstitials to the current fingerprint."""
    with _session_lock:
        for session, _ in _sessions.values():
            try:
                session.__exit__(None, None, None)
            except Exception:
                pass
        _sessions.clear()


# Retried: 429 (rate limited) and 5xx (transient). 403 is retried too, but only because these
# sites serve 403 from their bot-detection edge rather than as a real authorization failure - a
# fresh session/fingerprint often clears it.
RETRY_STATUSES = {403, 429, 500, 502, 503, 504}


def request(url, *, pool="default", prime=None, **kwargs):
    """GET `url` through the anti-block stack, with throttling and 429-aware backoff.

    pool:  which cookie jar/session to use - pass a per-site key ("nse") when a site needs its
           cookies kept together, so an unrelated fetch can't rotate them out mid-flow.
    prime: URL to fetch first on a freshly built session (a site's own homepage), mimicking the
           human funnel of landing on the site before hitting a deep JSON endpoint.
    """
    last_error = None
    for attempt in range(MAX_RETRIES):
        session = _get_session(pool)
        if prime and getattr(session, "_primed_for", None) != prime:
            _throttle(prime)
            try:
                session.get(prime, timeout=TIMEOUT)
                session._primed_for = prime
            except Exception:
                pass  # priming is best-effort; the real request below still gets its own try

        _throttle(url)
        try:
            response = session.get(url, timeout=TIMEOUT, **kwargs)
        except Exception as e:  # transport-level (timeout, proxy down, TLS reset)
            last_error = e
            time.sleep(min(2**attempt + random.uniform(0, 1), MAX_BACKOFF))
            continue

        if response.status not in RETRY_STATUSES:
            return response

        last_error = RuntimeError(f"{url} returned {response.status}")
        if attempt == MAX_RETRIES - 1:
            break
        # Exponential backoff (1s, 2s, 4s...) plus jitter so parallel workers don't all retry on
        # the same beat, unless the server named its own delay.
        time.sleep(_retry_after_seconds(response) or min(2**attempt + random.uniform(0, 1), MAX_BACKOFF))
        # A block is about *this* identity, so retrying on the same cookies/fingerprint mostly
        # wastes the attempt - rotate before trying again.
        reset_sessions()

    raise last_error or RuntimeError(f"failed to fetch {url}")


def get_html(url, **kwargs):
    """Page HTML as text. Raises on persistent failure."""
    return request(url, **kwargs).html_content


def get_json(url, **kwargs):
    """Parsed JSON body from an API endpoint."""
    return request(url, **kwargs).json()


def yf_session():
    """A curl_cffi session for yfinance's `Ticker(session=...)`.

    yfinance 1.5.1 already talks to Yahoo over curl_cffi, so it has browser TLS out of the box -
    this exists to push those calls through the configured proxy too, and is None (yfinance's own
    default) when no proxy is set, rather than second-guessing a working default.
    """
    if not PROXIES:
        return None
    from curl_cffi import requests as curl_requests

    return curl_requests.Session(impersonate=IMPERSONATE, proxies={"https": random.choice(PROXIES),
                                                                   "http": random.choice(PROXIES)})

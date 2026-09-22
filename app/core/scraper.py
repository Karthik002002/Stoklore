"""Fetches NSE India movers (nseindia.com) plus news/financials (Yahoo Finance via yfinance).

Every outbound fetch here goes through netfetch, which carries the anti-block transport (browser
TLS fingerprint, coherent browser headers, optional residential proxies, per-host throttling and
429-aware backoff). See netfetch.py - nothing in this module should call requests.get directly.
"""
import html
import json
import re
from datetime import datetime, timedelta
from functools import lru_cache

import yfinance as yf
from bs4 import BeautifulSoup
from ddgs import DDGS

from app.core import db
from app.core import netfetch

NSE_BASE = "https://www.nseindia.com"

FINANCIAL_FIELDS = ("marketCap", "trailingPE", "forwardPE", "sector", "shortName")


def _ticker(symbol):
    """yfinance Ticker routed through the configured proxy (no-op when none is set)."""
    return yf.Ticker(symbol, session=netfetch.yf_session())


# Yahoo suffixes the exchange onto Indian tickers: RELIANCE.NS is the NSE line, RELIANCE.BO the BSE
# one. Which one a symbol takes is a property of the stock, so it is read from the master rather
# than hardcoded at thirteen call sites the way ".NS" used to be.
YF_SUFFIX = {"NSE": "NS", "BSE": "BO"}


def _stock_ticker(symbol):
    """The yfinance Ticker for a stock, on whichever exchange the master says it trades.

    A symbol not in the master at all resolves to NSE - which is what every symbol did before BSE
    support existed, and what a hand-typed journal symbol still does.

    ponytail: one indexed primary-key lookup per call, uncached. An lru_cache here would go stale
    the moment a master import runs, and this is a local DB read in front of a network fetch that
    costs several orders of magnitude more.
    """
    exchange, board = db.exchange_of(symbol)
    if exchange == "NSE" and board == "SME":
        return _ticker(_nse_sme_yahoo_symbol(symbol))
    return _ticker(f"{symbol}.{YF_SUFFIX.get(exchange, 'NS')}")


@lru_cache(maxsize=1024)
def _nse_sme_yahoo_symbol(symbol):
    """Yahoo is inconsistent about NSE SME stocks: some carry full history under the plain
    SYMBOL.NS, others exist only as SYMBOL-SM.NS (for both the SM and ST series) - and that one holds
    just the latest quote, no history. So the plain ticker wins whenever it has any bars, and -SM is
    the fallback that at least resolves the stock.

    ponytail: cached per process (one probe per SME symbol), so a stock Yahoo later backfills under
    the plain ticker is picked up on restart. NSE's own SME history API is the upgrade path if
    -SM-only stocks need real charts."""
    plain = f"{symbol}.NS"
    try:
        if not _ticker(plain).history(period="5d").empty:
            return plain
    except Exception:
        pass
    return f"{symbol}-SM.NS"


def _nse_json(path):
    """NSE 403s any API call whose session hasn't first landed on the homepage and picked up its
    edge cookies, so every NSE fetch primes on NSE_BASE and shares one pooled cookie jar."""
    return netfetch.get_json(f"{NSE_BASE}{path}", pool="nse", prime=NSE_BASE)


def get_movers(count=25):
    """Returns deduped list of {symbol, changePercent, volume, avgVolume} for NSE stocks."""
    movers = {}

    variations = _nse_json("/api/live-analysis-variations?index=gainers")
    variations.update(_nse_json("/api/live-analysis-variations?index=loosers"))
    for row in variations.get("allSec", {}).get("data", []):
        movers[row["symbol"]] = {
            "symbol": row["symbol"],
            "changePercent": row.get("perChange", 0.0),
            "volume": row.get("trade_quantity", 0),
            "avgVolume": row.get("trade_quantity", 0) or 1,
        }

    volume_gainers = _nse_json("/api/live-analysis-volume-gainers")
    for row in volume_gainers.get("data", [])[:count]:
        movers.setdefault(row["symbol"], {"symbol": row["symbol"], "changePercent": row.get("pChange", 0.0)})
        movers[row["symbol"]]["volume"] = row.get("volume", 0)
        movers[row["symbol"]]["avgVolume"] = row.get("week1AvgVolume", 0) or 1

    return list(movers.values())[:count]


# NSE's top gainers/losers table (nseindia.com/market-data/top-gainers-losers). One request per
# direction returns EVERY bucket at once - the seven index cuts the page's own dropdown offers -
# so this is two fetches for the whole table, not two per bucket.
#
# `legends` in the payload maps bucket key -> display label, which is what the UI's selector shows;
# reading it from the response rather than hardcoding means a bucket NSE adds or renames follows
# automatically.
MOVER_FIELDS = ("symbol", "series", "ltp", "prev_price", "perChange", "trade_quantity", "turnover")


def _mover_row(row):
    """One row of the movers table. `net_price` is skipped deliberately: it usually equals
    perChange but sometimes carries a different basis (an ex-dividend day, for instance), so the
    rupee move is derived from ltp - prev_price where both are known and can be checked."""
    ltp, prev = row.get("ltp"), row.get("prev_price")
    ca = (row.get("ca_purpose") or "").strip()
    return {
        **{k: row.get(k) for k in MOVER_FIELDS},
        "change": round(ltp - prev, 2) if ltp is not None and prev is not None else None,
        # '-' is NSE's own "nothing here"; keep only a real corporate action, which is often the
        # whole explanation for a name sitting at the top or bottom of the table.
        "ca_purpose": ca if ca and ca != "-" else None,
        "ca_ex_date": row.get("ca_ex_dt") or None,
    }


def get_top_movers():
    """NSE's top gainers and losers for every index bucket, in one payload.

    Returns {timestamp, trade_date, groups: [{key, label, gainers: [...], losers: [...]}]}.
    `trade_date` is the ISO session date parsed out of NSE's own '14-Aug-2026 16:00:00' timestamp -
    the table is a post-close snapshot, so the date it belongs to is the number worth storing and
    showing, not the moment it was fetched.
    """
    gainers = _nse_json("/api/live-analysis-variations?index=gainers")
    losers = _nse_json("/api/live-analysis-variations?index=loosers")

    labels = {key: label for key, label in gainers.get("legends", []) or []}
    labels.update({key: label for key, label in losers.get("legends", []) or []})

    timestamp = None
    groups = []
    for key, label in labels.items():
        up, down = gainers.get(key) or {}, losers.get(key) or {}
        timestamp = timestamp or up.get("timestamp") or down.get("timestamp")
        groups.append({
            "key": key,
            "label": label,
            "gainers": [_mover_row(r) for r in up.get("data") or []],
            "losers": [_mover_row(r) for r in down.get("data") or []],
        })

    trade_date = None
    if timestamp:
        try:
            trade_date = datetime.strptime(timestamp.split(" ")[0], "%d-%b-%Y").date().isoformat()
        except ValueError:
            trade_date = None
    return {"timestamp": timestamp, "trade_date": trade_date, "groups": groups}


def _jsonld_article_body(soup):
    """Many news CMSes (this includes Economic Times/ETEnergyworld) embed the full plain-text
    article in a schema.org NewsArticle/Article JSON-LD block for SEO - the visible page itself
    may not put the article body in <p> tags at all, so a naive <p> scrape there just picks up
    nav/comment-policy boilerplate instead. Returns (title, text) or None if no block has one."""
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for node in data if isinstance(data, list) else [data]:
            for n in node.get("@graph", [node]) if isinstance(node, dict) else [node]:
                if isinstance(n, dict) and n.get("articleBody"):
                    return n.get("headline"), html.unescape(n["articleBody"])
    return None


def _fetch_html(url):
    """Page HTML via the shared anti-block transport (netfetch): browser TLS fingerprint, real
    browser headers, throttling and 429 backoff. There's no plain-requests fallback any more - a
    bare Python UA/TLS handshake is exactly what the sites that 403 here are detecting, so
    retrying that way only burned the IP a second time."""
    return netfetch.get_html(url)


def scrape_article(url):
    """Fetches an arbitrary news/blog URL and returns its title + best-effort body text."""
    soup = BeautifulSoup(_fetch_html(url), "html.parser")

    jsonld = _jsonld_article_body(soup)
    if jsonld:
        headline, text = jsonld
        return {"title": headline or (soup.title.get_text(strip=True) if soup.title else url), "text": text}

    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form"]):
        tag.decompose()
    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else (soup.title.get_text(strip=True) if soup.title else url)
    text = " ".join(p.get_text(" ", strip=True) for p in soup.find_all("p"))
    return {"title": title, "text": text}


# --- screener.in company page ------------------------------------------------------------------
# Screener publishes things Yahoo/yfinance doesn't expose at all: 12 years of financials (vs
# yfinance's ~4 quarters), bank-specific NPA ratios, the shareholding-pattern trend, ROCE, its own
# rule-based pros/cons commentary, and BSE filings with one-line summaries. Everything below is
# parsed out of the static HTML - the peer-comparison table is AJAX-loaded and the "Insights"
# section is login-gated (renders as xx,xxx placeholders), so neither is available here.
SCREENER_URL = "https://www.screener.in/company/{}/"

SCREENER_TABLES = {
    "quarters": "Quarterly Results",
    "profit-loss": "Profit & Loss",
    "balance-sheet": "Balance Sheet",
    "cash-flow": "Cash Flows",
    "ratios": "Ratios",
    "shareholding": "Shareholding Pattern",
}


def _screener_text(node):
    """Collapses whitespace and drops the trailing '+' screener puts on expandable row labels."""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip().rstrip("+").strip()


def _screener_table(section):
    """One financial table as {periods, rows:[{label, values}]}. Values stay as display strings -
    a single table mixes units per row (₹ Cr, %, Rs/share), so parsing them to floats would lose
    what each number actually means."""
    table = section.find("table")
    rows = table.find_all("tr") if table else []
    if not rows:
        return None
    periods = [_screener_text(c) for c in rows[0].find_all(["th", "td"])][1:]
    parsed = []
    for tr in rows[1:]:
        cells = tr.find_all(["th", "td"])
        label = _screener_text(cells[0]) if cells else ""
        # "Raw PDF" is a trailing row of attachment links, not data.
        if len(cells) < 2 or not label or label.lower().startswith("raw pdf"):
            continue
        parsed.append({"label": label, "values": [_screener_text(c) for c in cells[1:]]})
    return {"periods": periods, "rows": parsed} if parsed else None


def _screener_documents(soup):
    """Filings grouped as they appear on the page (Announcements / Annual reports / Credit
    ratings / Concalls). Announcements carry screener's own one-line summary of the filing."""
    section = soup.find("section", id="documents")
    if not section:
        return {}
    groups = {}
    for h3 in section.find_all("h3"):
        box = h3.find_parent("div", class_="documents")
        if not box:
            continue
        items = []
        for li in box.find_all("li"):
            # Announcements/reports/ratings are one <a> per row, with a nested
            # <div class="ink-600"> holding the age + screener's one-line summary. Concall rows
            # differ: they lead with a quarter label and carry several links (Transcript, PPT),
            # so the label is prefixed onto each and the row yields one item per link. The
            # "AI Summary" control there is a modal button with no href - skipped.
            lead = li.find("div", recursive=False)
            prefix = _screener_text(lead) if lead else ""
            for link in li.find_all("a", href=True):
                sub = link.find("div")
                detail = _screener_text(sub) if sub else None
                if sub:
                    sub.extract()  # so it isn't repeated inside the title below
                title = _screener_text(link)
                items.append({
                    "title": f"{prefix} · {title}" if prefix else title,
                    "detail": detail,
                    "url": link["href"],
                })
        if items:
            groups[_screener_text(h3)] = items
    return groups


def parse_screener_html(html_text, url):
    """Split out from get_screener_data so the parsing can be checked without a network fetch
    (see test_screener.py). Returns None if this isn't a company page."""
    soup = BeautifulSoup(html_text, "html.parser")

    heading = soup.find("h1")
    if not heading:
        return None  # not a company page (404/interstitial)

    ratios = []
    top = soup.find("ul", id="top-ratios")
    for li in top.find_all("li") if top else []:
        label, value = li.find("span", class_="name"), li.find("span", class_="value")
        if label and value:
            ratios.append({"label": _screener_text(label), "value": _screener_text(value)})

    tables = {}
    for section_id, title in SCREENER_TABLES.items():
        section = soup.find("section", id=section_id)
        parsed = _screener_table(section) if section else None
        if parsed:
            tables[section_id] = {"title": title, **parsed}

    profile = soup.find("div", class_="company-profile")
    about = profile.find("div", class_="about") if profile else None
    key_points = profile.find("div", class_="commentary") if profile else None
    # Breadcrumb under "Peer comparison" - broad sector > sector > broad industry > industry.
    peers = soup.find("section", id="peers")
    industry = [_screener_text(a) for a in peers.find("p", class_="sub").find_all("a")] if (
        peers and peers.find("p", class_="sub")
    ) else []

    return {
        "url": url,
        "name": _screener_text(heading),
        "about": _screener_text(about) if about else None,
        "keyPoints": _screener_text(key_points) if key_points else None,
        "industry": industry,
        "ratios": ratios,
        "pros": [_screener_text(li) for li in soup.find("div", class_="pros").find_all("li")]
        if soup.find("div", class_="pros") else [],
        "cons": [_screener_text(li) for li in soup.find("div", class_="cons").find_all("li")]
        if soup.find("div", class_="cons") else [],
        "tables": tables,
        "documents": _screener_documents(soup),
    }


def get_screener_data(symbol):
    """Everything parseable off a screener.in company page. Returns None if the symbol has no
    page there (screener covers listed companies only, and uses its own symbol for a few)."""
    url = SCREENER_URL.format(symbol)
    try:
        html_text = _fetch_html(url)
    except Exception:
        return None
    return parse_screener_html(html_text, url)


# --- screener.in screens ---------------------------------------------------------------------------
# A screen is a saved query ("Promoter holding > 40 AND ...") and the table of companies matching it.
# Public pages, no login, one data-table per page, 50 rows per page at most via ?limit=50&page=N.
#
# The columns are NOT fixed: screener adds one per condition in the query, so a promoter-holding
# screen has "Change in Prom Hold %" and a growth screen has "NP 2Qtr Bk". Rows come back keyed by
# the column's own tooltip ("Current Price" -> current_price), which is what a workflow template
# refers to - never by position.

SCREEN_PAGE_SIZE = 50
#: Pages fetched per run unless asked otherwise. A 344-result screen is 7 pages at 50 a page; four
#: is 200 companies, which is more than any alert should be about, and every page is a throttled
#: request to someone else's server.
SCREEN_MAX_PAGES = 4
_SCREEN_PATH = re.compile(r"^/screens/(\d+)/([\w-]*)/?$")


class ScreenLoginRequired(ValueError):
    """screener.in answered a screen with its register page instead of results.

    It lets an anonymous visitor open a handful of screens and then redirects to /register/ - the
    same URL that returned a full table minutes earlier. Named separately so the message can say
    what actually happened, rather than guessing "private or deleted". A ValueError, so every
    caller that already reports a bad screen URL reports this too without a new except clause."""


def screen_url(url):
    """The canonical https://www.screener.in/screens/<id>/<slug>/ for a pasted screen URL, or
    ValueError. This is a server-side fetch of a user-supplied URL, so anything that is not a
    screener.in screen is refused outright rather than fetched and then parsed as nothing."""
    from urllib.parse import urlparse

    parsed = urlparse((url or "").strip())
    host = (parsed.hostname or "").lower()
    match = _SCREEN_PATH.match(parsed.path or "")
    if parsed.scheme not in ("http", "https") or host not in ("screener.in", "www.screener.in") or not match:
        raise ValueError("that isn't a screener.in screen URL - it should look like "
                         "https://www.screener.in/screens/86/quarterly-growers/")
    return f"https://www.screener.in/screens/{match.group(1)}/{match.group(2)}/".replace("//", "/").replace(
        "https:/", "https://"
    )


def _column_key(label):
    key = label.lower().replace("%", " pct")
    return re.sub(r"[^a-z0-9]+", "_", key).strip("_")


def _screen_number(text):
    """Screen cells are clean decimals ("1300.50", "-62.04"), unlike a company page's mixed-unit
    tables - so these do become numbers, which is what lets a condition node compare them. Blank
    stays None; anything that still isn't a number stays the string it was."""
    cleaned = text.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return text


def parse_screen_html(html_text, url):
    """One page of a screen as {name, url, query, total, page, pages, columns, rows}, or None if the
    page has no results table. Split from get_screen so it runs against a fixture (test_screener.py).
    """
    soup = BeautifulSoup(html_text, "html.parser")
    # The register wall is a 200 with a sign-up form, not an error status - so it has to be recognised
    # by content, or it parses as a screen with no table and gets reported as the wrong problem.
    if soup.find("form", action="/register/"):
        raise ScreenLoginRequired(
            "screener.in is asking for a login before it will show this screen - it limits how many "
            "screens an anonymous visitor can open. The screen itself is fine."
        )
    table = soup.select_one("table.data-table")
    if table is None:
        return None

    header = next((tr for tr in table.find_all("tr") if tr.find("th")), None)
    columns = []
    for th in (header.find_all("th") if header else [])[2:]:  # S.No., Company
        label = th.get("data-tooltip") or _screener_text(th)
        columns.append({"key": _column_key(label), "label": _screener_text(th) or label})

    rows = []
    # Rows are picked by their company link, not by position: screener repeats the header row
    # part-way down a long table, and "skip the first row" would read it as a company.
    for tr in table.find_all("tr"):
        link = tr.find("a", href=re.compile(r"^/company/"))
        if link is None:
            continue
        code = re.match(r"^/company/([^/]+)/", link["href"]).group(1)
        # A company with no NSE listing is addressed by its numeric BSE code instead. Kept apart so
        # a template never hands "538786" to a tool that expects an NSE ticker.
        row = {
            "symbol": None if code.isdigit() else code,
            "bse_code": code if code.isdigit() else None,
            "name": _screener_text(link),
            "url": f"https://www.screener.in{link['href']}",
        }
        for column, cell in zip(columns, tr.find_all("td")[2:]):
            row[column["key"]] = _screen_number(_screener_text(cell))
        rows.append(row)

    name = soup.find("h1")
    query = soup.find("textarea", attrs={"name": "query"})
    found = re.search(r"([\d,]+)\s+results?\s+found(?:.*?page\s+(\d+)\s+of\s+(\d+))?",
                      soup.get_text(" ", strip=True), re.I)
    total = int(found.group(1).replace(",", "")) if found else len(rows)
    return {
        "name": _screener_text(name) if name else None,
        "url": url,
        "query": query.get_text().strip() if query else None,
        "total": total,
        "page": int(found.group(2)) if found and found.group(2) else 1,
        "pages": int(found.group(3)) if found and found.group(3) else max(1, -(-total // SCREEN_PAGE_SIZE)),
        "columns": columns,
        "rows": rows,
    }


#: Screener's own cookie jar, kept apart from every other site's - and the page an unauthenticated
#: visit lands on first, the same human funnel netfetch primes NSE with.
SCREENER_POOL = "screener"
SCREENER_HOME = "https://www.screener.in/"


def _fetch_screen_html(url, session_cookie=None):
    """A screen page, signed in as the user when they have saved a session cookie (Settings →
    Screener). Sent as a header rather than a cookie jar so it survives a session rotation."""
    headers = {"cookie": f"sessionid={session_cookie.strip()}"} if session_cookie else None
    return netfetch.get_html(url, pool=SCREENER_POOL, prime=SCREENER_HOME, headers=headers)


def _login_wall_help(session_cookie):
    """The wall means different things with and without a saved cookie: one is "set it up", the
    other is "yours has expired". Both keep the base message, so callers still read as a login."""
    return (
        " The saved screener.in session cookie didn't work - it has probably expired. Paste a fresh "
        "one in Settings → Screener."
        if session_cookie
        else " Paste your own screener.in session cookie in Settings → Screener, so unattended runs "
        "can open screens."
    )


def get_screen(url, max_pages=SCREEN_MAX_PAGES, session_cookie=None):
    """Every company a screen matches, up to `max_pages` pages of 50. Raises ValueError for a URL
    that isn't a screen, or a page that came back without a results table (removed, or private).

    `session_cookie` is the user's own screener.in `sessionid` (db.get_screener_cookie()). Without
    one, screener serves its register page after a handful of screens - which is what a 06:15 run
    hits, with nobody there to log in.
    """
    base = screen_url(url)
    try:
        return _get_screen(base, max_pages, session_cookie)
    except ScreenLoginRequired as e:
        raise ScreenLoginRequired(f"{e}{_login_wall_help(session_cookie)}") from e


def _get_screen(base, max_pages, session_cookie):
    def _fetch_html(u):
        return _fetch_screen_html(u, session_cookie)

    first = parse_screen_html(_fetch_html(f"{base}?limit={SCREEN_PAGE_SIZE}&page=1"), base)
    if first is None:
        raise ValueError("screener.in returned no results table for that screen - it may be "
                         "private or deleted")
    wanted = min(first["pages"], max(1, int(max_pages)))
    for page in range(2, wanted + 1):
        more = parse_screen_html(_fetch_html(f"{base}?limit={SCREEN_PAGE_SIZE}&page={page}"), base)
        if more is None or not more["rows"]:
            break
        first["rows"].extend(more["rows"])
    # Said out loud, so a template never mistakes "the first 200" for "all of them".
    first["fetched_pages"] = wanted
    first["truncated"] = wanted < first["pages"]
    return first


def web_search(query, limit=10):
    """General-purpose web search (DuckDuckGo via the ddgs library, no API key needed) - lets the
    LLM agent research something not covered by the NSE/Yahoo Finance scrapers above, e.g. an
    open-ended "what's going on with this stock" investigation. Returns [{title, url, snippet}]."""
    with DDGS() as ddgs:
        results = ddgs.text(query, max_results=limit)
    return [{"title": r["title"], "url": r["href"], "snippet": r["body"]} for r in results]


COGENCIS_NEWS_URL = "https://data.cogencis.com/api/v1/web/news/stories"
# Only the app-specific bits - the User-Agent and the rest of the browser header set come from
# netfetch's stealthy headers, which keeps them internally consistent with the impersonated TLS
# fingerprint (a hand-pinned UA that disagrees with the handshake is worse than none).
COGENCIS_HEADERS_BASE = {
    "accept": "application/json, text/plain, */*",
    "origin": "https://iinvest.cogencis.com",
}


def get_isin(symbol):
    """NSE ISIN for a symbol - Cogencis news (below) is keyed/matched by ISIN, not NSE symbol."""
    return _stock_ticker(symbol).isin


def _cogencis_rows(token, params):
    headers = {**COGENCIS_HEADERS_BASE, "authorization": f"Bearer {token}"}
    payload = netfetch.get_json(COGENCIS_NEWS_URL, pool="cogencis", headers=headers, params=params)
    return payload.get("response", {}).get("data", [])


def _cogencis_item(row):
    raw_time = row.get("sourceDateTime") or row.get("enteredDateTime")
    try:
        published_at = datetime.fromisoformat(raw_time) if raw_time else None
    except ValueError:
        published_at = None
    return {
        "title": row.get("headline", ""),
        "summary": row.get("synopsis") or "",
        "url": row.get("sourceLink") or "",
        "published_at": published_at,
        "source": row.get("sourceName") or row.get("source") or "",
        "isins": row.get("isins", ""),
        "origin": "cogencis",
    }


def get_cogencis_news(isin, token, limit=20):
    """Recent news stories for one stock from Cogencis (data.cogencis.com), keyed by ISIN. Needs a
    Cogencis session bearer token (Settings > Cogencis) - these expire after ~24h (grabbed from
    the browser's network tab while signed into iinvest.cogencis.com) and must be pasted in again
    once they do; there's no login flow here to auto-renew them. Returns the same shape as
    get_news: [{title, summary, url, published_at, source, origin}]."""
    rows = _cogencis_rows(token, {"sWebNews": "true", "forWebSite": "true", "pageNo": 1,
                                   "pageSize": limit, "isins": isin})
    return [_cogencis_item(r) for r in rows]


def get_cogencis_top_news(token, page_no=1, page_size=20):
    """One page of Cogencis's general top-news feed (data.cogencis.com) - not scoped to any one
    stock, this is their homepage "what's moving" feed. Same token/expiry caveats as
    get_cogencis_news above. Each item's `isins` field lists every stock the story mentions, e.g.
    "INE099Z01011 MISHDHAT.BS MISHDHAT.NS, INE258A01016 BEML.BS BEML.NS" - api.py's top-news
    endpoint uses that to flag which watchlisted stocks a story affects."""
    rows = _cogencis_rows(token, {"pageNo": page_no, "pageSize": page_size})
    return [_cogencis_item(r) for r in rows]


def get_news(symbol, limit=10):
    """Returns list of {title, summary, url, published_at, source, origin} for an NSE symbol's
    recent news."""
    items = []
    for item in _stock_ticker(symbol).news[:limit]:
        c = item.get("content", {})
        pub_date = c.get("pubDate")
        items.append({
            "title": c.get("title", ""),
            "summary": c.get("summary", ""),
            "url": (c.get("canonicalUrl") or {}).get("url", ""),
            "published_at": datetime.fromisoformat(pub_date) if pub_date else None,
            "source": (c.get("provider") or {}).get("displayName", ""),
            "origin": "yfinance",
        })
    return items


QUOTE_FIELDS = (
    "shortName", "sector", "industry", "marketCap", "trailingPE", "forwardPE",
    "priceToBook", "bookValue", "dividendYield", "beta", "trailingEps",
    "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "currentPrice", "previousClose",
    "regularMarketChangePercent", "regularMarketVolume", "averageVolume",
)


# Indian benchmarks first (what this app is actually about), then the global indices worth a
# glance for overnight context on the dashboard's ticker tape. /api/indices loops this whole dict
# and caches each entry for 15min independently, so adding a name here is all it takes to surface
# it - but every new one is another (cached) yfinance call on a cold start, so keep it short.
INDEX_SYMBOLS = {
    "NIFTY": "^NSEI",
    "SENSEX": "^BSESN",
    "BANKNIFTY": "^NSEBANK",
    "INDIAVIX": "^INDIAVIX",
    "DOW": "^DJI",
    "NASDAQ": "^IXIC",
    "FTSE": "^FTSE",
    "NIKKEI": "^N225",
}


def _fast_quote(ticker):
    fi = ticker.fast_info
    last, prev = fi.get("lastPrice"), fi.get("previousClose")
    change = (last - prev) / prev * 100 if last and prev else None
    return {"price": last, "changePercent": change}


def _fallback_quote(symbol):
    """moneycontrol's chart feed, used only when Yahoo has no price for a symbol.

    Yahoo simply does not carry most NSE SME (EMERGE) scrips - every suffix comes back "possibly
    delisted" - so without a second source an SME name has no price anywhere in the app and a paper
    order on one fails with "no live price available". moneycontrol keys on the same NSE symbol, so
    there is nothing to map.

    Imported lazily: this is the cold path, and scraper is imported by nearly everything.
    """
    try:
        from app.core import moneycontrol_local

        return moneycontrol_local.last_quote(symbol)
    except Exception:
        return None


def get_price(symbol):
    """Fast live price + day change% for list views. Falls back to moneycontrol when Yahoo has
    nothing (see _fallback_quote) rather than reporting a null price for a tradable symbol."""
    # yfinance doesn't return an empty quote for a symbol it has never heard of - fast_info raises
    # (KeyError 'exchangeTimezoneName') while trying to read metadata that isn't there. Catching it
    # here is what lets the fallback run at all.
    try:
        quote = _fast_quote(_stock_ticker(symbol))
    except Exception:
        quote = {"price": None, "changePercent": None}
    if quote.get("price") is not None:
        return quote
    fallback = _fallback_quote(symbol)
    if fallback is None:
        return quote
    return {"price": fallback["price"], "changePercent": fallback["changePercent"]}


def get_index_price(name):
    """Fast live price + day change% for a market index (NIFTY/SENSEX), same shape as get_price."""
    return _fast_quote(_ticker(INDEX_SYMBOLS[name]))


def get_quote(symbol):
    """Full live fundamentals for the stock detail page.

    When Yahoo has no price (SME scrips, see _fallback_quote) the price fields are filled from
    moneycontrol and the fundamentals stay None - a price with no P/E is the honest shape of what
    that source knows, and it is what every quote-dependent path (paper order entry, the exit
    engine, the stocks list) actually needs.
    """
    try:
        info = _stock_ticker(symbol).info
    except Exception:
        info = {}
    quote = {k: info.get(k) for k in QUOTE_FIELDS}
    if quote.get("currentPrice") is not None:
        return quote
    fallback = _fallback_quote(symbol)
    if fallback is None:
        return quote
    return {
        **quote,
        "currentPrice": fallback["price"],
        "previousClose": fallback["previousClose"],
        "regularMarketChangePercent": fallback["changePercent"],
        "regularMarketVolume": fallback["volume"],
    }


# UI range -> (yahoo period, bar interval)
CHART_RANGES = {
    "1d": ("1d", "5m"),
    "5d": ("5d", "15m"),
    "1mo": ("1mo", "1d"),
    "6mo": ("6mo", "1d"),
    "ytd": ("ytd", "1d"),
    "1y": ("1y", "1d"),
    "5y": ("5y", "1wk"),
    "max": ("max", "1mo"),
}

# How far back each range reaches, in calendar days ("ytd" is handled separately below).
RANGE_DAYS = {"1d": 1, "5d": 5, "1mo": 30, "6mo": 182, "1y": 365, "5y": 365 * 5}

# Extra calendar days fetched *before* the requested range so indicators (e.g. a 50-day EMA)
# have enough prior bars to be plotted across the whole visible range instead of only the back
# half of it. "max" already pulls full history, so it needs no extra warmup.
WARMUP_DAYS = {"1d": 5, "5d": 25, "1mo": 120, "6mo": 120, "ytd": 120, "1y": 120, "5y": 500}


def _chart_bars(ticker, range_key):
    """OHLCV bars for the chart, via yfinance (wraps Yahoo's v8/finance/chart endpoint).

    Returns extra warmup bars before `visibleFrom` so indicators can be computed across the
    whole visible range; the frontend slices bars >= visibleFrom for the actual price series.
    """
    period, interval = CHART_RANGES[range_key]

    warmup = WARMUP_DAYS.get(range_key)
    if warmup is None:
        df = ticker.history(period=period, interval=interval)
        visible_from = None
    else:
        cutoff = (
            datetime(datetime.now().year, 1, 1)
            if range_key == "ytd"
            else datetime.now() - timedelta(days=RANGE_DAYS[range_key])
        )
        df = ticker.history(start=cutoff - timedelta(days=warmup), interval=interval)
        visible_from = int(cutoff.timestamp())

    bars = [
        {
            # lightweight-charts displays UTC; pre-shift to IST so intraday bars show market-local time
            "time": int(ts.timestamp()) + int(ts.utcoffset().total_seconds()),
            "open": round(row["Open"], 2),
            "high": round(row["High"], 2),
            "low": round(row["Low"], 2),
            "close": round(row["Close"], 2),
            "volume": int(row["Volume"]),
        }
        for ts, row in df.iterrows()
        if row[["Open", "High", "Low", "Close"]].notna().all()
    ]
    return {"bars": bars, "interval": interval, "visibleFrom": visible_from}


def get_chart(symbol, range_key):
    return _chart_bars(_stock_ticker(symbol), range_key)


def get_index_chart(name, range_key):
    """Same shape as get_chart, for a market index (NIFTY/SENSEX)."""
    return _chart_bars(_ticker(INDEX_SYMBOLS[name]), range_key)


# NSE publishes a broad index-performance table (nseindia.com/market-data/index-performances) that's
# loaded by an XHR to /api/allIndexes (plural, not to be confused with the /api/allIndices quote
# endpoint). The JSON is key-grouped ("INDICES ELIGIBLE IN DERIVATIVES", "BROAD MARKET INDICES",
# "SECTORAL INDICES", "STRATEGY INDICES", "THEMATIC INDICES") - surfaced wholesale since the same
# grouping is what the dashboard's table groups by too. Only the columns the UI actually renders are
# kept, the rest (chart paths, indicativeClose, per-component advances/declines) are dropped.
NSE_ALLINDICES_URL = f"{NSE_BASE}/api/allIndices"


def get_all_indices():
    """Returns {timestamp, groups:[{key, indices:[{name, last, percentChange, perChange30d,
    perChange365d, pe, pb, dy, advances, declines}]}]} for NSE's index-performance page. Cookie-
    primed via _nse_json(); a bare request without the homepage hit gets 403'd by NSE's edge."""
    payload = _nse_json("/api/allIndices")

    groups = {}
    for row in payload.get("data", []):
        key = row.get("key") or "Uncategorized"
        groups.setdefault(key, []).append({
            "name": row.get("index", ""),
            "symbol": row.get("indexSymbol", ""),
            "last": row.get("last"),
            "change": row.get("variation"),
            "percentChange": row.get("percentChange"),
            "open": row.get("open"),
            "high": row.get("high"),
            "low": row.get("low"),
            "previousClose": row.get("previousClose"),
            "yearHigh": row.get("yearHigh"),
            "yearLow": row.get("yearLow"),
            "pe": row.get("pe"),
            "pb": row.get("pb"),
            "dy": row.get("dy"),
            "advances": row.get("advances"),
            "declines": row.get("declines"),
            "unchanged": row.get("unchanged"),
            "perChange30d": row.get("perChange30d"),
            "perChange365d": row.get("perChange365d"),
        })

    return {
        "timestamp": payload.get("timestamp"),
        "advances": payload.get("advances"),
        "declines": payload.get("declines"),
        "unchanged": payload.get("unchanged"),
        "groups": [{"key": k, "indices": v} for k, v in groups.items()],
    }


def get_history(symbol, start, end):
    """Summarizes OHLCV price history between two YYYY-MM-DD dates. Returns None if no data."""
    df = _stock_ticker(symbol).history(start=start, end=end)
    if df.empty:
        return None
    return {
        "start": start,
        "end": end,
        "tradingDays": len(df),
        "open": float(df["Open"].iloc[0]),
        "close": float(df["Close"].iloc[-1]),
        "high": float(df["High"].max()),
        "low": float(df["Low"].min()),
        "changePercent": float((df["Close"].iloc[-1] - df["Open"].iloc[0]) / df["Open"].iloc[0] * 100),
        "avgVolume": int(df["Volume"].mean()),
    }


def get_financial_statements(symbol):
    """Quarterly + TTM income statement as a table: oldest-to-newest columns, Yahoo's row order."""
    ticker = _stock_ticker(symbol)
    quarterly = ticker.quarterly_income_stmt
    if quarterly.empty:
        return None
    ttm = ticker.ttm_income_stmt

    # yfinance returns newest-column-first and roughly bottom-up rows vs. Yahoo's page - flip both.
    quarterly = quarterly.iloc[::-1, ::-1]
    periods = [c.strftime("%Y-%m-%d") for c in quarterly.columns]

    rows = []
    for label in quarterly.index:
        values = [None if v != v else float(v) for v in quarterly.loc[label]]
        ttm_val = ttm.loc[label].iloc[0] if ttm is not None and label in ttm.index else None
        values.append(None if ttm_val is None or ttm_val != ttm_val else float(ttm_val))
        rows.append({"label": label, "values": values})

    return {"periods": periods + ["TTM"], "rows": rows}


def get_daily_bars(symbol, start=None, period="1y"):
    """Daily OHLCV bars for symbol as plain dicts, via yfinance. start=None fetches a full
    `period` backfill (default 1y, pass period="max" for a symbol's entire available history);
    start='YYYY-MM-DD' fetches only bars from that date forward (incremental gap-fill, ignores
    `period`)."""
    ticker = _stock_ticker(symbol)
    df = ticker.history(period=period, interval="1d") if start is None else ticker.history(start=start, interval="1d")
    return [
        {
            "date": ts.date().isoformat(),
            "open": round(row["Open"], 2), "high": round(row["High"], 2),
            "low": round(row["Low"], 2), "close": round(row["Close"], 2),
            "volume": int(row["Volume"]),
        }
        for ts, row in df.iterrows()
        if row[["Open", "High", "Low", "Close"]].notna().all()
    ]


def get_intraday_bars(symbol, period, interval):
    """Intraday OHLCV bars as plain dicts, via yfinance - the fallback path for minute_data.py
    when the HuggingFace minute dataset doesn't cover a symbol. Yahoo only serves a shallow window
    for sub-daily intervals (~60d), nowhere near the dataset's 2022-onward depth.

    `date` is the IST calendar day (what Bar Replay's date-jump/start-date pickers match on) and
    `time` the IST-shifted unix seconds lightweight-charts plots - same two-field shape
    minute_data.get_minute_bars returns, and the same pre-shift trick _chart_bars uses."""
    ticker = _stock_ticker(symbol)
    df = ticker.history(period=period, interval=interval)
    return [
        {
            "date": ts.date().isoformat(),
            "time": int(ts.timestamp()) + int(ts.utcoffset().total_seconds()),
            "open": round(row["Open"], 2), "high": round(row["High"], 2),
            "low": round(row["Low"], 2), "close": round(row["Close"], 2),
            "volume": int(row["Volume"]),
        }
        for ts, row in df.iterrows()
        if row[["Open", "High", "Low", "Close"]].notna().all()
    ]


def get_corporate_actions(symbol, since_days=30):
    """Returns list of {action_type, date, detail} for a symbol's recent dividends/splits and
    upcoming earnings dates. action_type is 'dividend' | 'split' | 'earnings'.
    Verified against yfinance 1.5.1: .actions is a DataFrame with a tz-aware date index and
    'Dividends'/'Stock Splits' columns; .calendar is a dict with an 'Earnings Date' date list
    (used instead of get_earnings_dates(), which needs the lxml package)."""
    ticker = _stock_ticker(symbol)
    events = []

    actions = ticker.actions
    if not actions.empty:
        cutoff = datetime.now(actions.index.tz) - timedelta(days=since_days)
        for ts, row in actions[actions.index >= cutoff].iterrows():
            if row.get("Dividends"):
                events.append({"action_type": "dividend", "date": ts.date().isoformat(),
                               "detail": f"Dividend of ₹{row['Dividends']:g} per share"})
            if row.get("Stock Splits"):
                events.append({"action_type": "split", "date": ts.date().isoformat(),
                               "detail": f"Stock split {row['Stock Splits']:g}:1"})

    try:
        for d in (ticker.calendar or {}).get("Earnings Date", []):
            events.append({"action_type": "earnings", "date": d.isoformat(),
                           "detail": f"Earnings scheduled for {d.isoformat()}"})
    except Exception:
        pass  # no calendar data for this symbol - fine, skip earnings events

    return events


def get_financials(symbol):
    """Returns dict of key financial stats for an NSE symbol. marketCap is INR (NSE), formatted with ₹."""
    info = _stock_ticker(symbol).info
    financials = {k: info.get(k) for k in FINANCIAL_FIELDS}
    if financials.get("marketCap") is not None:
        financials["marketCap"] = f"₹{financials['marketCap']:,}"
    return financials

"""Fetches NSE India movers (nseindia.com) plus news/financials (Yahoo Finance via yfinance).

Every outbound fetch here goes through netfetch, which carries the anti-block transport (browser
TLS fingerprint, coherent browser headers, optional residential proxies, per-host throttling and
429-aware backoff). See netfetch.py - nothing in this module should call requests.get directly.
"""
import html
import json
import re
from datetime import datetime, timedelta

import yfinance as yf
from bs4 import BeautifulSoup
from ddgs import DDGS

import netfetch

NSE_BASE = "https://www.nseindia.com"

FINANCIAL_FIELDS = ("marketCap", "trailingPE", "forwardPE", "sector", "shortName")


def _ticker(symbol):
    """yfinance Ticker routed through the configured proxy (no-op when none is set)."""
    return yf.Ticker(symbol, session=netfetch.yf_session())


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
    return _ticker(f"{symbol}.NS").isin


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
    for item in _ticker(f"{symbol}.NS").news[:limit]:
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


def get_price(symbol):
    """Fast live price + day change% for list views."""
    return _fast_quote(_ticker(f"{symbol}.NS"))


def get_index_price(name):
    """Fast live price + day change% for a market index (NIFTY/SENSEX), same shape as get_price."""
    return _fast_quote(_ticker(INDEX_SYMBOLS[name]))


def get_quote(symbol):
    """Full live fundamentals for the stock detail page."""
    info = _ticker(f"{symbol}.NS").info
    return {k: info.get(k) for k in QUOTE_FIELDS}


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
    return _chart_bars(_ticker(f"{symbol}.NS"), range_key)


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
    df = _ticker(f"{symbol}.NS").history(start=start, end=end)
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
    ticker = _ticker(f"{symbol}.NS")
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
    ticker = _ticker(f"{symbol}.NS")
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
    ticker = _ticker(f"{symbol}.NS")
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
    ticker = _ticker(f"{symbol}.NS")
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
    info = _ticker(f"{symbol}.NS").info
    financials = {k: info.get(k) for k in FINANCIAL_FIELDS}
    if financials.get("marketCap") is not None:
        financials["marketCap"] = f"₹{financials['marketCap']:,}"
    return financials

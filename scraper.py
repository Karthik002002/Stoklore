"""Fetches NSE India movers (nseindia.com) plus news/financials (Yahoo Finance via yfinance)."""
from datetime import datetime, timedelta

import requests
import yfinance as yf
from bs4 import BeautifulSoup

NSE_BASE = "https://www.nseindia.com"
NSE_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

FINANCIAL_FIELDS = ("marketCap", "trailingPE", "forwardPE", "sector", "shortName")


def _nse_session():
    """NSE blocks requests without a browser-primed cookie, so hit the homepage first."""
    session = requests.Session()
    session.headers.update(NSE_HEADERS)
    session.get(NSE_BASE, timeout=10)
    return session


def get_movers(count=25):
    """Returns deduped list of {symbol, changePercent, volume, avgVolume} for NSE stocks."""
    session = _nse_session()
    movers = {}

    variations = session.get(f"{NSE_BASE}/api/live-analysis-variations?index=gainers", timeout=10).json()
    variations.update(session.get(f"{NSE_BASE}/api/live-analysis-variations?index=loosers", timeout=10).json())
    for row in variations.get("allSec", {}).get("data", []):
        movers[row["symbol"]] = {
            "symbol": row["symbol"],
            "changePercent": row.get("perChange", 0.0),
            "volume": row.get("trade_quantity", 0),
            "avgVolume": row.get("trade_quantity", 0) or 1,
        }

    volume_gainers = session.get(f"{NSE_BASE}/api/live-analysis-volume-gainers", timeout=10).json()
    for row in volume_gainers.get("data", [])[:count]:
        movers.setdefault(row["symbol"], {"symbol": row["symbol"], "changePercent": row.get("pChange", 0.0)})
        movers[row["symbol"]]["volume"] = row.get("volume", 0)
        movers[row["symbol"]]["avgVolume"] = row.get("week1AvgVolume", 0) or 1

    return list(movers.values())[:count]


def scrape_article(url):
    """Fetches an arbitrary news/blog URL and returns its title + best-effort body text."""
    resp = requests.get(url, headers=NSE_HEADERS, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form"]):
        tag.decompose()
    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else (soup.title.get_text(strip=True) if soup.title else url)
    text = " ".join(p.get_text(" ", strip=True) for p in soup.find_all("p"))
    return {"title": title, "text": text}


def get_news(symbol, limit=10):
    """Returns list of {title, summary, url, published_at} for an NSE symbol's recent news."""
    items = []
    for item in yf.Ticker(f"{symbol}.NS").news[:limit]:
        c = item.get("content", {})
        pub_date = c.get("pubDate")
        items.append({
            "title": c.get("title", ""),
            "summary": c.get("summary", ""),
            "url": (c.get("canonicalUrl") or {}).get("url", ""),
            "published_at": datetime.fromisoformat(pub_date) if pub_date else None,
        })
    return items


QUOTE_FIELDS = (
    "shortName", "sector", "industry", "marketCap", "trailingPE", "forwardPE",
    "priceToBook", "bookValue", "dividendYield", "beta", "trailingEps",
    "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "currentPrice", "previousClose",
    "regularMarketChangePercent", "regularMarketVolume", "averageVolume",
)


def get_price(symbol):
    """Fast live price + day change% for list views."""
    fi = yf.Ticker(f"{symbol}.NS").fast_info
    last, prev = fi.get("lastPrice"), fi.get("previousClose")
    change = (last - prev) / prev * 100 if last and prev else None
    return {"price": last, "changePercent": change}


def get_quote(symbol):
    """Full live fundamentals for the stock detail page."""
    info = yf.Ticker(f"{symbol}.NS").info
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


def get_chart(symbol, range_key):
    """OHLCV bars for the chart, via yfinance (wraps Yahoo's v8/finance/chart endpoint).

    Returns extra warmup bars before `visibleFrom` so indicators can be computed across the
    whole visible range; the frontend slices bars >= visibleFrom for the actual price series.
    """
    period, interval = CHART_RANGES[range_key]
    ticker = yf.Ticker(f"{symbol}.NS")

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


def get_history(symbol, start, end):
    """Summarizes OHLCV price history between two YYYY-MM-DD dates. Returns None if no data."""
    df = yf.Ticker(f"{symbol}.NS").history(start=start, end=end)
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
    ticker = yf.Ticker(f"{symbol}.NS")
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


def get_daily_bars(symbol, start=None):
    """Daily OHLCV bars for symbol as plain dicts, via yfinance. start=None fetches a full 1y
    backfill; start='YYYY-MM-DD' fetches only bars from that date forward (incremental gap-fill)."""
    ticker = yf.Ticker(f"{symbol}.NS")
    df = ticker.history(period="1y", interval="1d") if start is None else ticker.history(start=start, interval="1d")
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


def get_corporate_actions(symbol, since_days=30):
    """Returns list of {action_type, date, detail} for a symbol's recent dividends/splits and
    upcoming earnings dates. action_type is 'dividend' | 'split' | 'earnings'.
    Verified against yfinance 1.5.1: .actions is a DataFrame with a tz-aware date index and
    'Dividends'/'Stock Splits' columns; .calendar is a dict with an 'Earnings Date' date list
    (used instead of get_earnings_dates(), which needs the lxml package)."""
    ticker = yf.Ticker(f"{symbol}.NS")
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
    info = yf.Ticker(f"{symbol}.NS").info
    financials = {k: info.get(k) for k in FINANCIAL_FIELDS}
    if financials.get("marketCap") is not None:
        financials["marketCap"] = f"₹{financials['marketCap']:,}"
    return financials

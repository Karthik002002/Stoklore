"""Fetches NSE India movers (nseindia.com) plus news/financials (Yahoo Finance via yfinance)."""
import requests
import yfinance as yf

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


def get_news(symbol, limit=5):
    """Returns list of {title, summary, url} for an NSE symbol's recent news."""
    items = []
    for item in yf.Ticker(f"{symbol}.NS").news[:limit]:
        c = item.get("content", {})
        items.append({
            "title": c.get("title", ""),
            "summary": c.get("summary", ""),
            "url": (c.get("canonicalUrl") or {}).get("url", ""),
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


def get_financials(symbol):
    """Returns dict of key financial stats for an NSE symbol. marketCap is INR (NSE), formatted with ₹."""
    info = yf.Ticker(f"{symbol}.NS").info
    financials = {k: info.get(k) for k in FINANCIAL_FIELDS}
    if financials.get("marketCap") is not None:
        financials["marketCap"] = f"₹{financials['marketCap']:,}"
    return financials

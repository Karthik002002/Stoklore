"""BSE's active-equity scrip list, in the row shape db.upsert_stocks_master already takes.

NSE ships CSVs a person downloads and uploads; BSE serves the whole list as one JSON call - ~4,979
active equity scrips with the scrip code, trading symbol, ISIN and issuer name. So this importer
needs no file picker, which is why it is a button rather than an upload form.

The ISIN is the load-bearing field. Most BSE names are the same companies already listed on NSE,
and importing them as new rows would double the master, split every watchlist and give one company
two stock pages. So a row whose ISIN already exists is merged onto the NSE row - it only attaches
`bse_code` - and only genuinely BSE-EXCLUSIVE scrips become rows of their own. See
db.upsert_bse_master for the merge itself.

Self-check: .venv/bin/python tests/bse_master.selfcheck.py
"""
from app.core import netfetch

BSE_BASE = "https://www.bseindia.com"
SCRIP_LIST_URL = (
    "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
    "?Group=&Scripcode=&industry=&segment=Equity&status=Active"
)

# api.bseindia.com serves the site's own XHRs and answers a request with no Origin/Referer with an
# error page (HTTP 200, HTML body), not a 403 - so an unheadered call fails as unparseable JSON
# rather than as an obvious block. netfetch's stealthy headers invent a plausible Referer of their
# own (google.com), which is exactly wrong here, hence these being explicit.
HEADERS = {
    "Origin": BSE_BASE,
    "Referer": f"{BSE_BASE}/",
    "Accept": "application/json, text/plain, */*",
}

# BSE's own groups. A/B/T are the ordinary equity groups; M/MT/MS are the SME platform, which is
# the same distinction NSE's SM/ST series draws, so it maps onto the master's existing `board`.
SME_GROUPS = {"M", "MT", "MS"}


def parse_scrip(row):
    """One ListofScripData row -> a stocks_master row, or None when it can't be keyed.

    The trading symbol (`scrip_id`, e.g. "ABB") is used as the symbol rather than the numeric scrip
    code: it is what a person types and what yfinance's .BO tickers expect. The numeric code is
    kept alongside because BSE's own APIs address scrips only by it.
    """
    symbol = (row.get("scrip_id") or "").strip().upper()
    code = str(row.get("SCRIP_CD") or "").strip()
    if not symbol or not code:
        return None
    group = (row.get("GROUP") or "").strip().upper()
    return {
        "symbol": symbol,
        # Issuer_Name is the legal name ("ABB India Limited"); Scrip_Name is the display one. The
        # legal name matches what NSE's CSVs carry, so a merged row doesn't flip-flop between the
        # two spellings on every import.
        "name": (row.get("Issuer_Name") or row.get("Scrip_Name") or "").strip() or symbol,
        "series": group or None,
        "listing_date": None,  # not in this payload; NSE rows keep whatever they already had
        "isin": (row.get("ISIN_NUMBER") or "").strip().upper() or None,
        "board": "SME" if group in SME_GROUPS else "MAIN",
        "market_lot": None,
        "face_value": _float(row.get("FACE_VALUE")),
        "exchange": "BSE",
        "bse_code": code,
    }


def _float(value):
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def fetch_scrips():
    """Every active BSE equity scrip, parsed. One request for the whole list."""
    rows = netfetch.request(SCRIP_LIST_URL, pool="bse", headers=HEADERS).json()
    if not isinstance(rows, list):
        raise RuntimeError("BSE scrip list did not come back as a list - the API likely blocked us")
    return [p for p in (parse_scrip(r) for r in rows) if p]

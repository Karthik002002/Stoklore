"""Microcap universe: every listed company in a market-cap band, with enough fundamentals, strength
and ownership data to shortlist long-term candidates - and objective red flags, never a verdict.

Three sources, joined on the NSE symbol:
  * screener.in, one raw screen query over the whole band (~50 pages of 50) - the only place that
    has market cap, ROCE, growth, debt and cash flow for every company at once. Needs the user's
    own session cookie (Settings → Screener); an anonymous visit hits the register wall.
  * the bhavcopy strength table (strength.stock_table) - RS rating, returns, 52-week position,
    liquidity. Main board EQ only, so SME names come through with these blank.
  * NSE shareholding filings - promoter holding trend, and off-cycle filings (SEBI requires one
    only after a capital change over 2%, so they flag dilution).

Everything below fetch_universe is pure, so the selfcheck runs it on fixtures.
"""
import time
from datetime import date, timedelta
from urllib.parse import urlencode

from app.core import scraper

# ponytail: fixed band, make it a setting if ₹100-2000 Cr ever needs changing
MCAP_MIN_CR = 100
MCAP_MAX_CR = 2000

# Band only. Signed in, screener shows the columns from YOUR column settings (screener.in → any
# screen → "Edit columns"), not one per condition - and a padding condition like "Debt to equity >
# -1e9" silently drops every company with that cell blank (842 of 2,088 when tried). So the query
# filters on market cap alone and the metrics are whatever columns the account has switched on.
QUERY = f"Market Capitalization > {MCAP_MIN_CR} AND Market Capitalization < {MCAP_MAX_CR}"
RAW_URL = "https://www.screener.in/screen/raw/"
MAX_PAGES = 80  # 4,000 companies; the band is ~2,100
# Screener 429s at netfetch's 1-1.75s cadence after ~25 pages. A weekly job has time: ~3 min a pull.
PAGE_GAP = 4.0

# our field -> screener column keys (scraper._column_key of the tooltip), first match wins. The first
# group is in screener's default column set; the rest appear once switched on in "Edit columns".
FIELDS = {
    "price": ["current_price", "cmp_rs"],
    "mcap_cr": ["market_capitalization", "mar_cap_rs_cr"],
    "pe": ["price_to_earning", "p_e"],
    "roce": ["return_on_capital_employed", "roce_pct"],
    "roe": ["return_on_equity"],
    "div_yield": ["dividend_yield"],
    "np_qtr_cr": ["net_profit_latest_quarter"],
    "sales_qtr_cr": ["sales_latest_quarter"],
    "qtr_profit_yoy": ["yoy_quarterly_profit_growth"],
    "qtr_sales_yoy": ["yoy_quarterly_sales_growth"],
    "fii_pct": ["fii_holding"],
    "fii_chg_qtr": ["change_in_fii_holding"],
    "fii_chg_3y": ["change_in_fii_holding_3years"],
    "promoter_chg_qtr": ["change_in_promoter_holding"],
    # opt-in columns
    "pb": ["price_to_book_value"],
    "opm": ["opm", "operating_profit_margin"],
    "sales_cr": ["sales", "sales_rs_cr"],
    "profit_cr": ["net_profit", "np_12m_rs_cr"],
    "sales_cagr_3y": ["sales_growth_3years"],
    "profit_cagr_3y": ["profit_growth_3years"],
    "sales_cagr_5y": ["sales_growth_5years"],
    "profit_cagr_5y": ["profit_growth_5years"],
    "debt_equity": ["debt_to_equity"],
    "promoter_pct_screener": ["promoter_holding"],
    "pledge_pct": ["pledged_percentage"],
    "cfo_cr": ["cash_from_operations_last_year"],
    "np_last_year_cr": ["net_profit_last_year"],
}

# red-flag thresholds - facts to look into, not reasons to reject
LIQUID_MIN_CR = 0.5  # ₹50L median daily turnover
PROMOTER_DROP = 2.0  # percentage points over the last four quarterly filings
DEBT_EQUITY_MAX = 1.0
CFO_TO_PROFIT_MIN = 0.5


def fetch_universe(session_cookie, max_pages=MAX_PAGES):
    """Every company in the band as screener rows. Raises scraper.ScreenLoginRequired when the
    cookie is missing or expired. The URL is ours, never user input, so no screen_url() check."""
    rows, page, pages = [], 1, 1
    while page <= min(pages, max_pages):
        url = f"{RAW_URL}?{urlencode({'query': QUERY, 'limit': scraper.SCREEN_PAGE_SIZE, 'page': page})}"
        parsed = scraper.parse_screen_html(scraper._fetch_screen_html(url, session_cookie), url)
        if parsed is None or not parsed["rows"]:
            break
        rows.extend(parsed["rows"])
        pages = parsed["pages"]
        page += 1
        if page <= min(pages, max_pages):
            time.sleep(PAGE_GAP)
    return rows


def normalise(row):
    """A screener row in our field names. Unknown/blank cells become None, strings that should be
    numbers too - a column screener renamed reads as missing, not as garbage."""
    out = {"symbol": row.get("symbol"), "bse_code": row.get("bse_code"), "name": row.get("name"),
           "screener_url": row.get("url")}
    for field, keys in FIELDS.items():
        out[field] = next((row[k] for k in keys if isinstance(row.get(k), (int, float))), None)
    return out


def ownership(filings, today=None):
    """{symbol: {promoter_pct, promoter_chg_4q, off_cycle_2y}} from shareholding filings sorted
    oldest-first per symbol (db.list_shareholding_filings' order)."""
    cutoff = (today or date.today()) - timedelta(days=730)
    by_sym = {}
    for f in filings:
        if f["promoter_pct"] is not None and not f["is_revision"]:
            by_sym.setdefault(f["symbol"], []).append(f)
    out = {}
    for sym, fs in by_sym.items():
        quarterly = [f for f in fs if _quarter_end(f["period_date"])]
        last = quarterly[-1] if quarterly else fs[-1]
        base = quarterly[-5] if len(quarterly) >= 5 else (quarterly[0] if quarterly else None)
        out[sym] = {
            "promoter_pct": last["promoter_pct"],
            "promoter_chg_4q": round(last["promoter_pct"] - base["promoter_pct"], 2) if base and base is not last else None,
            "off_cycle_2y": sum(1 for f in fs if not _quarter_end(f["period_date"]) and f["period_date"] >= cutoff),
        }
    return out


def _quarter_end(d):
    return (d.month, d.day) in ((3, 31), (6, 30), (9, 30), (12, 31))


def red_flags(r):
    """Objective checks on one joined row, as short labels. Missing data never raises a flag."""
    flags = []
    if (r.get("pledge_pct") or 0) > 0:
        flags.append(f"pledge {r['pledge_pct']:g}%")
    if r.get("promoter_chg_4q") is not None and r["promoter_chg_4q"] <= -PROMOTER_DROP:
        flags.append(f"promoter {r['promoter_chg_4q']:+g}pp in 4Q")
    cfo, np_ = r.get("cfo_cr"), r.get("np_last_year_cr")
    if cfo is not None and np_ is not None and np_ > 0 and cfo < CFO_TO_PROFIT_MIN * np_:
        flags.append("cash flow below profit")
    if (r.get("debt_equity") or 0) > DEBT_EQUITY_MAX:
        flags.append(f"D/E {r['debt_equity']:g}")
    if r.get("off_cycle_2y"):
        flags.append(f"{r['off_cycle_2y']} capital change filing(s) in 2y")
    if r.get("avg_value_cr") is not None and r["avg_value_cr"] < LIQUID_MIN_CR:
        flags.append("illiquid")
    return flags


STRENGTH_FIELDS = ("rs", "r3m", "r12m", "from_high_pct", "avg_value_cr", "template_score")


def build(screener_rows, strength_rows, own):
    """Joined, flagged rows, biggest RS first (unrated last). `strength_rows` = stock_table's
    `stocks`; `own` = ownership(). Rows without an NSE symbol (BSE-only) keep their fundamentals."""
    strength_by = {s["symbol"]: s for s in strength_rows}
    out = []
    for raw in screener_rows:
        r = normalise(raw)
        s = strength_by.get(r["symbol"], {})
        r.update({k: s.get(k) for k in STRENGTH_FIELDS})
        o = own.get(r["symbol"], {})
        r["promoter_pct"] = o.get("promoter_pct", r["promoter_pct_screener"])
        r["promoter_chg_4q"] = o.get("promoter_chg_4q")
        r["off_cycle_2y"] = o.get("off_cycle_2y", 0)
        r["flags"] = red_flags(r)
        r["key"] = r["symbol"] or r["bse_code"]
        out.append(r)
    out.sort(key=lambda r: (r["rs"] is None, -(r["rs"] or 0)))
    return out


# --- theses ---------------------------------------------------------------------------------------


def thesis_breaches(thesis, row):
    """The limits a thesis set that this snapshot row now breaks, as labels. A missing number breaks
    nothing; a stock gone from the snapshot entirely (moved out of the band, delisted) is reported."""
    if row is None:
        return ["no longer in the microcap band"]
    out = []
    if thesis.get("min_roce") is not None and row.get("roce") is not None and row["roce"] < thesis["min_roce"]:
        out.append(f"ROCE {row['roce']:g}% below {thesis['min_roce']:g}%")
    if thesis.get("max_pe") is not None and row.get("pe") is not None and row["pe"] > thesis["max_pe"]:
        out.append(f"P/E {row['pe']:g} above {thesis['max_pe']:g}")
    base = (thesis.get("baseline") or {}).get("promoter_pct")
    if thesis.get("max_promoter_drop") is not None and base is not None and row.get("promoter_pct") is not None:
        drop = base - row["promoter_pct"]
        if drop > thesis["max_promoter_drop"]:
            out.append(f"promoter down {drop:.2f}pp since the thesis (limit {thesis['max_promoter_drop']:g})")
    return out


QUARTER_FIELDS = ("sales_qtr_cr", "np_qtr_cr", "qtr_sales_yoy", "qtr_profit_yoy")


def quarter_diff(prev, row):
    """{field: [before, after]} when the latest-quarter figures moved between two snapshots - which
    is what a results filing looks like from a weekly pull. None when nothing changed (or a side is
    missing), so a quiet week says nothing."""
    if not prev or not row:
        return None
    moved = {f: [prev.get(f), row.get(f)] for f in QUARTER_FIELDS if prev.get(f) != row.get(f)}
    reported = prev.get("sales_qtr_cr") != row.get("sales_qtr_cr") or prev.get("np_qtr_cr") != row.get("np_qtr_cr")
    return moved if reported and row.get("sales_qtr_cr") is not None else None


def since_baseline(thesis, row, fields=("price", "roce", "pe", "promoter_pct", "rs", "mcap_cr")):
    """{field: [at thesis, now]} for the drawer's "since you wrote this" line."""
    base = thesis.get("baseline") or {}
    return {f: [base.get(f), (row or {}).get(f)] for f in fields}

"""Promoter shareholding, and - the point of the whole module - HOW it changed.

A promoter going 15% -> 66% in one quarter and 15% -> 18% over four quarters both "went up", and
they mean nearly opposite things. Gradual accumulation is usually open-market buying with the
promoter's own money: real skin in the game. A sudden jump almost never is - it is a preferential
allotment, a warrant conversion, a reclassification or a change of control, and which one it is
decides whether it is bullish or a warning.

The percentages CANNOT tell those apart, and this is the fact the module is built around. Every
category sums to 100, so issuing new shares to promoters pushes promoter% up and public% down by
exactly the shape that buying from the public would. Worked example, AJOONI's 2026 filings:

    30-JUN   promoter 46,324,766 (26.89%)   public 125,918,832 (73.11%)   total 172,243,598
    12-AUG   promoter 55,324,766 (30.53%)   public 125,918,832 (69.47%)   total 181,243,598

Promoter +3.64pp, and the public sold nothing at all - their share count is identical to the digit.
Nine million new shares were issued to a sixth promoter entity that did not exist the quarter
before. On percentages alone that reads as accumulation; it is dilution of everyone else.

So the ledger stores SHARE COUNTS, and the verdicts below are decided on them:

    total flat + promoter up + public down   -> bought from the public (organic)
    total up   + promoter up ~= total delta  -> shares issued TO the promoter (not a purchase)
    total up   + promoter flat               -> everyone else diluted
    total flat + promoter entity count drops -> looks like reclassification, needs the filing read

Two data sources, deliberately unequal in cost:

  * `/api/corporate-share-holdings-master` - ONE call covers every listed company for a date range
    (~2,500 filings per quarter). Percentages only, but it is what makes a daily sweep affordable.
  * the per-filing XBRL - ~85-270 KB each, and the only place share and shareholder counts live.
    Fetched only for filings that actually moved (see needs_detail), and only once ever: a filing
    is immutable, and a revision arrives as its own row with its own recordId.

Nothing here decides that a corporate action was good or bad - that needs the filing itself read by
a person. It decides which handful of stocks are worth reading, instead of eyeballing shareholding
tables across a whole watchlist every quarter.

Self-check: .venv/bin/python tests/shareholding.selfcheck.py
"""
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta

from app.core import netfetch

NSE_BASE = "https://www.nseindia.com"
# The master endpoint refuses ranges much wider than a quarter, so history is walked in windows.
WINDOW_DAYS = 90
# How far back a full seed may reach. Five years is the deepest the UI offers; the endpoint itself
# will happily be asked for older windows, this is only the guard on "collect everything".
MAX_SEED_YEARS = 5

# A filing whose promoter percentage moved less than this is not worth an XBRL fetch: at that size
# the mechanism question doesn't arise, and it is 2,000+ of the ~2,500 filings in a quarter.
DETAIL_MIN_PP = 0.5

# How far the total share count may drift and still count as "no new shares". Not zero: buybacks,
# ESOP allotments and rounding all move it slightly without being the event we're looking for.
FLAT_SHARES_PCT = 0.1


def _nse_json(path):
    """Same priming rule as scraper.py - NSE 403s an API call whose session hasn't first landed on
    the homepage. Shares that module's cookie pool deliberately, so both sweep NSE as one client
    rather than two competing for the same edge cookies."""
    return netfetch.get_json(f"{NSE_BASE}{path}", pool="nse", prime=NSE_BASE)


def _d(value):
    """NSE's '30-JUN-2026' (and the occasional '30-Jun-2026') as a date. None when unparseable -
    a filing with no readable period is dropped rather than guessed at."""
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip()[:11], "%d-%b-%Y").date()
    except ValueError:
        return None


def _pct(value):
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


def _int(value):
    try:
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None


def parse_master_row(row):
    """One row of the master endpoint -> the columns worth storing, or None if it isn't usable.

    `recordId` is NSE's own key for a filing and is what makes the whole thing re-runnable: a sweep
    that overlaps a window already collected upserts the same ids instead of duplicating quarters.
    """
    symbol = (row.get("symbol") or "").strip().upper()
    period = _d(row.get("date"))
    record_id = str(row.get("recordId") or "").strip()
    if not symbol or not period or not record_id:
        return None
    return {
        "record_id": record_id,
        "symbol": symbol,
        "isin": (row.get("isin") or "").strip() or None,
        "company": (row.get("name") or "").strip() or None,
        "period_date": period,
        "submission_date": _d(row.get("submissionDate")),
        "promoter_pct": _pct(row.get("pr_and_prgrp")),
        "public_pct": _pct(row.get("public_val")),
        "employee_trust_pct": _pct(row.get("employeeTrusts")),
        "dr_pct": _pct(row.get("underlyingDrs")),
        # A restatement of a period already filed. Counting it as a fresh period would invent a
        # quarter's worth of change out of a correction.
        "is_revision": str(row.get("revisedData") or "").strip().lower() == "revised",
        "xbrl_url": (row.get("xbrl") or "").strip() or None,
    }


def fetch_window(from_date, to_date):
    """Every listed company's filings in one date range - one HTTP call for the lot."""
    path = (
        "/api/corporate-share-holdings-master?index=equities"
        f"&from_date={from_date:%d-%m-%Y}&to_date={to_date:%d-%m-%Y}"
    )
    rows = _nse_json(path)
    if not isinstance(rows, list):
        return []
    return [p for p in (parse_master_row(r) for r in rows) if p]


def windows(years, today=None):
    """The (from, to) ranges covering `years` back from today, newest first.

    Newest first on purpose: a seed that is interrupted (or rate-limited) half way has the recent
    quarters, which are the ones the screener actually reads.
    """
    today = today or date.today()
    years = max(1, min(int(years), MAX_SEED_YEARS))
    end = today
    out = []
    start_limit = today - timedelta(days=365 * years)
    while end > start_limit:
        start = max(end - timedelta(days=WINDOW_DAYS), start_limit)
        out.append((start, end))
        end = start - timedelta(days=1)
    return out


# --- the XBRL half ------------------------------------------------------------------------------
# Only four numbers are taken out of an 85-270 KB filing: promoter/public share counts and
# promoter/public holder counts (plus the allotment date when there is one). The sub-category
# breakdown is left in the file - it is not needed to answer "were new shares created", and storing
# it would mean a schema that has to track SEBI's category taxonomy.

_XBRLI = "{http://www.xbrl.org/2003/instance}"
PROMOTER_DIM = "ShareholdingOfPromoterAndPromoterGroupMember"
PUBLIC_DIM = "PublicShareholdingMember"


def parse_xbrl(xml_bytes):
    """{promoter_shares, public_shares, total_shares, promoter_holders, public_holders,
    allotment_date} from an NSE shareholding-pattern XBRL. Missing pieces come back as None rather
    than 0 - "not in this filing" and "zero shares" are very different claims.

    `total_shares` is promoter + public + everything else the filing reports, derived by summing
    the contexts rather than read from a total tag: the total row is dimension-less and shares its
    context with unrelated scalar facts, which makes it the one number easy to pick up wrong.
    """
    root = ET.fromstring(xml_bytes)

    dims = {}
    for context in root.iter(f"{_XBRLI}context"):
        members = [
            (el.text or "").split(":")[-1]
            for el in context.iter()
            if el.tag.endswith("explicitMember") and el.text
        ]
        dims[context.get("id")] = members

    def by_dim(tag):
        out = {}
        for el in root:
            if not el.tag.endswith(tag) or el.get("contextRef") is None:
                continue
            for member in dims.get(el.get("contextRef"), []):
                out.setdefault(member, _int(el.text))
        return out

    shares = by_dim("NumberOfFullyPaidUpEquityShares")
    holders = by_dim("NumberOfShareholders")
    allotment = next(
        (el.text for el in root if el.tag.endswith("DateOfAllotment") and el.text), None
    )

    promoter_shares = shares.get(PROMOTER_DIM)
    public_shares = shares.get(PUBLIC_DIM)
    total = sum(v for v in shares.values() if v) or None
    return {
        "promoter_shares": promoter_shares,
        "public_shares": public_shares,
        "total_shares": total,
        "promoter_holders": holders.get(PROMOTER_DIM),
        "public_holders": holders.get(PUBLIC_DIM),
        # Present only when the filing was triggered by an allotment - itself a strong hint that
        # new shares, not a purchase, are behind the move.
        "allotment_date": _d_iso(allotment),
    }


def _d_iso(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


def fetch_detail(xbrl_url):
    body = netfetch.request(xbrl_url, pool="nse", prime=NSE_BASE).body
    return parse_xbrl(body if isinstance(body, bytes) else body.encode())


def needs_detail(filing, previous):
    """Whether this filing earns an XBRL fetch: it moved by DETAIL_MIN_PP, or it is off-cycle.

    An off-cycle filing (a period that isn't a quarter end) exists BECAUSE a capital change over 2%
    happened - SEBI requires it within ten days - so the date alone is a corporate-action flag that
    costs nothing to read.
    """
    if not filing.get("xbrl_url"):
        return False
    if is_off_cycle(filing["period_date"]):
        return True
    if previous is None or filing.get("promoter_pct") is None or previous.get("promoter_pct") is None:
        # The first filing on record has nothing to compare against; take its detail anyway, so
        # the NEXT one has a baseline to be measured against.
        return previous is None
    return abs(filing["promoter_pct"] - previous["promoter_pct"]) >= DETAIL_MIN_PP


QUARTER_ENDS = {(3, 31), (6, 30), (9, 30), (12, 31)}


def is_off_cycle(period):
    return (period.month, period.day) not in QUARTER_ENDS


# --- what the change actually was ---------------------------------------------------------------

VERDICTS = {
    "no_change": "No material change",
    "organic_buy": "Bought from the public",
    "organic_sell": "Sold to the public",
    "issued_to_promoter": "New shares issued to the promoter",
    "diluted": "Diluted by an issue to others",
    "reclassification": "Looks like a reclassification",
    "unclear": "Needs the filing read",
    "detail_missing": "Share counts not fetched",
}


def _flat(delta, total):
    """Whether a share-count delta is small enough to be noise rather than an event."""
    return total and abs(delta) <= total * (FLAT_SHARES_PCT / 100)


def classify(previous, current):
    """How the holding changed between two consecutive filings of one symbol.

    Returns {verdict, promoter_pp, promoter_shares_delta, total_shares_delta, public_shares_delta,
    public_holders_delta, organic}. `organic` is the one-bit answer the screener sorts on: True
    when the shares demonstrably came from the public, False when they were created, None when the
    filing detail needed to tell isn't there.

    Deliberately NOT a diagnosis of the corporate action. A preferential allotment, a warrant
    conversion and a promoter subscribing to a rights issue all look the same from here, and
    separating them means reading the filing. Which one to read is exactly what this decides.
    """
    pp = None
    if previous.get("promoter_pct") is not None and current.get("promoter_pct") is not None:
        pp = round(current["promoter_pct"] - previous["promoter_pct"], 4)

    out = {
        "promoter_pp": pp,
        "promoter_shares_delta": None,
        "public_shares_delta": None,
        "total_shares_delta": None,
        "public_holders_delta": None,
        "organic": None,
        "verdict": "detail_missing",
    }

    fields = ("promoter_shares", "public_shares", "total_shares")
    if any(previous.get(f) is None or current.get(f) is None for f in fields):
        # Percentages alone: say so rather than guessing. A verdict invented from percentages is
        # precisely the mistake this module exists to stop.
        if pp is not None and abs(pp) < DETAIL_MIN_PP:
            out["verdict"] = "no_change"
        return out

    promoter_delta = current["promoter_shares"] - previous["promoter_shares"]
    public_delta = current["public_shares"] - previous["public_shares"]
    total_delta = current["total_shares"] - previous["total_shares"]
    base = previous["total_shares"]
    holders_delta = None
    if previous.get("public_holders") is not None and current.get("public_holders") is not None:
        holders_delta = current["public_holders"] - previous["public_holders"]

    out.update(
        promoter_shares_delta=promoter_delta,
        public_shares_delta=public_delta,
        total_shares_delta=total_delta,
        public_holders_delta=holders_delta,
    )

    total_flat = _flat(total_delta, base)
    promoter_flat = _flat(promoter_delta, base)
    public_flat = _flat(public_delta, base)

    if total_flat and promoter_flat:
        out["verdict"] = "no_change"
        return out

    if total_flat:
        # No new shares exist, so whatever the promoter gained came out of somebody else's holding.
        # A promoter ENTITY count that collapses while shares move the other way is the signature
        # of a reclassification (a promoter being re-labelled public), which is a change of
        # substance masquerading as a change of holding.
        promoter_holders_delta = None
        if previous.get("promoter_holders") is not None and current.get("promoter_holders") is not None:
            promoter_holders_delta = current["promoter_holders"] - previous["promoter_holders"]
        if promoter_delta < 0 and promoter_holders_delta is not None and promoter_holders_delta < 0:
            out["verdict"] = "reclassification"
            out["organic"] = False
            return out
        out["verdict"] = "organic_buy" if promoter_delta > 0 else "organic_sell"
        out["organic"] = True
        return out

    if total_delta > 0:
        # New shares. Who got them decides what it means.
        if public_flat and promoter_delta > 0:
            out["verdict"] = "issued_to_promoter"
            out["organic"] = False
            return out
        if promoter_flat:
            out["verdict"] = "diluted"
            out["organic"] = False
            return out

    out["verdict"] = "unclear"
    return out


# --- the screener ---------------------------------------------------------------------------------
# Everything below is pure over rows already in the database. Nothing derived is stored: a verdict
# is a function of two filings, and re-deriving it on read means a better rule (or a detail fetched
# later) improves every past row instead of leaving stale judgements behind - the same rule P&L,
# R:R and account return% already follow in this app.


def latest_per_period(filings):
    """One filing per period, newest submission winning. A revision restates a period already filed;
    counted as its own period it would invent a quarter's worth of change out of a correction."""
    by_period = {}
    for f in filings:
        current = by_period.get(f["period_date"])
        if current is None or (f.get("submission_date") or f["period_date"]) >= (
            current.get("submission_date") or current["period_date"]
        ):
            by_period[f["period_date"]] = f
    return [by_period[p] for p in sorted(by_period)]


def series_changes(filings):
    """Filing-to-filing changes for ONE symbol, oldest first. filings[0] has no predecessor and so
    no change - it is the baseline, not a zero."""
    ordered = latest_per_period(filings)
    out = []
    for previous, current in zip(ordered, ordered[1:]):
        out.append({
            "period_date": current["period_date"],
            "off_cycle": is_off_cycle(current["period_date"]),
            "promoter_pct": current.get("promoter_pct"),
            **classify(previous, current),
        })
    return out


def pace(changes, span):
    """Cumulative promoter movement over the last `span` changes, and how it arrived.

    The distinction the whole feature is about: +3pp spread over four quarters is a promoter buying
    with their own money; the same +3pp in one step is a corporate action wearing the same number.
    `steps` is how many filings the move took and `largest_step` the biggest single one, so "gradual"
    is a fact on the row rather than an impression from a chart.
    """
    recent = [c for c in changes[-span:] if c.get("promoter_pp") is not None]
    if not recent:
        return {"total_pp": None, "steps": 0, "largest_step": None, "gradual": None}
    total = round(sum(c["promoter_pp"] for c in recent), 4)
    largest = max(recent, key=lambda c: abs(c["promoter_pp"]))["promoter_pp"]
    return {
        "total_pp": total,
        "steps": len(recent),
        "largest_step": largest,
        # Gradual when no single filing carried most of the move. Undefined for a move too small to
        # describe either way.
        "gradual": None if abs(total) < DETAIL_MIN_PP else abs(largest) < abs(total) * 0.75,
    }


def screener_rows(filings, span=4):
    """One row per symbol for the screener table, newest movement first.

    `flag` is the sort key that does the actual work: 'verify' for a move whose mechanism is either
    unknown or known not to be a purchase, 'organic' for one the share counts confirm came out of
    the public's hands, and 'quiet' for everything else - which is most of the market, most
    quarters, and is exactly what the user should not have to read.
    """
    by_symbol = {}
    for f in filings:
        by_symbol.setdefault(f["symbol"], []).append(f)

    rows = []
    for symbol, symbol_filings in by_symbol.items():
        ordered = latest_per_period(symbol_filings)
        changes = series_changes(symbol_filings)
        latest = ordered[-1]
        last = changes[-1] if changes else None
        window = pace(changes, span)
        verdict = (last or {}).get("verdict", "detail_missing")

        if verdict in ("no_change",) or last is None:
            flag = "quiet"
        elif verdict in ("organic_buy", "organic_sell"):
            flag = "organic"
        else:
            flag = "verify"

        rows.append({
            "symbol": symbol,
            "company": latest.get("company"),
            "period_date": latest["period_date"],
            "off_cycle": is_off_cycle(latest["period_date"]),
            "promoter_pct": latest.get("promoter_pct"),
            "public_pct": latest.get("public_pct"),
            "filings": len(ordered),
            "has_detail": latest.get("detail_fetched_at") is not None,
            "last_change": last,
            "window": window,
            "flag": flag,
            # Enough points to draw the shape of the holding without shipping the whole table.
            "spark": [
                {"period_date": f["period_date"], "promoter_pct": f.get("promoter_pct")}
                for f in ordered[-(span + 4):]
            ],
        })

    # Biggest recent move first, and a symbol with no move at all last - the screener's job is to
    # put the handful worth reading at the top.
    rows.sort(key=lambda r: abs((r["last_change"] or {}).get("promoter_pp") or 0), reverse=True)
    return rows

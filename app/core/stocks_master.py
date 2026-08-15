"""Parses NSE's listed-equity master CSVs into the row shape db.upsert_stocks_master expects.

One parser covers both boards: which board a row belongs to is read off its SERIES code (SM/ST are
EMERGE, see SME_SERIES below) rather than from which file it arrived in - so importing either CSV,
in either order, tags every row correctly and re-importing one never mislabels the other.

Column names are matched loosely (case-folded, punctuation-insensitive, several known aliases per
field) because NSE's exports do not agree with each other: the main-board EQUITY_L.csv says
"NAME OF COMPANY"/"ISIN NUMBER", other lists say "COMPANY NAME"/"ISIN CODE", and a strict match
silently imported symbol-and-series-only rows with every other field blank. Anything unrecognised
is ignored rather than fatal - a row with a symbol is worth keeping.

MARKET LOT and FACE VALUE are kept (they used to be dropped): SME scrips trade only in fixed lots,
so the lot is the difference between a real order and an impossible one.
"""
import csv
import io
import re
from datetime import datetime

# NSE's EMERGE (SME) platform series. SM is the ordinary SME series, ST its trade-for-trade
# variant; everything else on these exports (EQ, BE, BZ, ...) is the main board.
SME_SERIES = {"SM", "ST", "SME"}

# Accepted header spellings per field, already normalised by _norm below.
ALIASES = {
    "symbol": ("SYMBOL", "TRADING SYMBOL", "NSE SYMBOL", "SECURITY ID"),
    "name": ("NAME OF COMPANY", "COMPANY NAME", "SECURITY NAME", "ISSUER NAME", "NAME", "COMPANY"),
    "series": ("SERIES", "SECURITY SERIES"),
    "listing_date": ("DATE OF LISTING", "LISTING DATE", "DATE OF LISTING DD MMM YYYY"),
    "isin": ("ISIN NUMBER", "ISIN CODE", "ISIN NO", "ISIN"),
    "market_lot": ("MARKET LOT", "MKT LOT", "LOT SIZE", "LOT"),
    "face_value": ("FACE VALUE", "FV"),
}

DATE_FORMATS = ("%d-%b-%Y", "%d-%B-%Y", "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d")


def _norm(key):
    """Header key stripped down to bare words: 'ISIN No.' and ' isin_no ' both become 'ISIN NO'."""
    return re.sub(r"[^A-Z0-9]+", " ", (key or "").upper()).strip()


def _field(row, field):
    for alias in ALIASES[field]:
        value = row.get(alias)
        if value:
            return value
    return None


def _date(value):
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _int(value):
    try:
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None


def _float(value):
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def board_for(series, default="MAIN"):
    """MAIN or SME for a series code. `default` is what an empty/unknown series falls back to, so a
    caller that knows which file it is holding can force the board for a CSV with no SERIES column."""
    if not series:
        return default
    return "SME" if series.strip().upper() in SME_SERIES else "MAIN"


def parse_csv(raw: bytes, board=None):
    """`board` forces every row onto that board ('MAIN'/'SME'); None (the default) derives it per
    row from SERIES."""
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for raw_row in reader:
        row = {_norm(k): (v or "").strip() for k, v in raw_row.items() if k}
        symbol = _field(row, "symbol")
        if not symbol:
            continue
        listing = _field(row, "listing_date")
        series = _field(row, "series")
        rows.append({
            "symbol": symbol.upper(),
            "name": _field(row, "name") or "",
            "series": series.upper() if series else None,
            "listing_date": _date(listing) if listing else None,
            "isin": _field(row, "isin"),
            "board": board or board_for(series),
            "market_lot": _int(_field(row, "market_lot")),
            "face_value": _float(_field(row, "face_value")),
        })
    return rows

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


# --- company name -> symbol ------------------------------------------------------------------------
# Sources that name companies without a ticker (ET Markets' sector members) are matched to the
# master by name. Exact on a normalised key, never fuzzy: a near miss that lands on the wrong
# company would open the wrong chart, which is worse than opening none.

_NAME_NOISE = {"ltd", "limited", "the", "and", "of", "co", "company", "corp", "corporation", "inc", "pvt", "private"}


def name_keys(name):
    """Match keys for a company name or URL slug, most specific first. Case, punctuation, spacing,
    '&'/'and', legal suffixes and plurals are ignored - 'L&T Technology Services Limited' and
    'lt-technology-services-ltd' share a key, as do 'Dr. Lal Path Labs Ltd.' / 'dr-lal-pathlabs-ltd'
    and 'SHREE CEMENT LIMITED' / 'shree-cements-ltd'. A second key without 'india' covers names that
    carry it on one side only."""
    text = (name or "").lower().replace("&", " and ").replace("'", "")
    words = [w for w in re.split(r"[^a-z0-9]+", text) if w and w not in _NAME_NOISE]
    # NSE abbreviates India as "(I)": "Berger Paints (I) Limited"
    words = ["india" if w == "i" else w for w in words]
    words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words]
    full = "".join(words)
    keys = [full] if full else []
    without_india = "".join(w for w in words if w != "india")
    if without_india and without_india != full:
        keys.append(without_india)
    return keys


def symbol_index(rows):
    """{key: symbol} from stocks_master rows ({symbol, name, exchange}). A key two different symbols
    share is dropped - ambiguous means unmatched. NSE listings win over BSE ones for the same key;
    a BSE-only key still maps (the chart resolves a BSE symbol through Yahoo's .BO). Every symbol is
    also indexed as itself under "sym:<SYMBOL>", for sources whose short name is the ticker."""
    out, clash = {}, set()
    for exchange in ("NSE", "BSE"):
        seen = {}
        for r in rows:
            if r.get("exchange", "NSE") != exchange or not r.get("symbol"):
                continue
            for key in name_keys(r.get("name")):
                if key in out:
                    continue  # an NSE listing already has it
                if key in seen and seen[key] != r["symbol"]:
                    clash.add(key)
                seen[key] = r["symbol"]
        out.update({k: v for k, v in seen.items() if k not in clash})
    for r in rows:
        if r.get("symbol"):
            out.setdefault(f"sym:{r['symbol'].upper()}", r["symbol"].upper())
    return out


def match_symbol(index, *names):
    """The symbol for the first of `names` (slug, full name, short name...) with a key in `index`,
    else the first name that IS a listed symbol, exactly ("SAIL")."""
    for name in names:
        for key in name_keys((name or "").replace("-", " ")):
            if key in index:
                return index[key]
    for name in names:
        ticker = re.sub(r"[^A-Za-z0-9&-]", "", name or "").upper()
        if ticker and f"sym:{ticker}" in index:
            return index[f"sym:{ticker}"]
    return None

"""Broker tradebook CSV -> journal trades.

A tradebook is execution rows, not trades: one order filled in five pieces is five rows, and a
position built over three days and sold in two is a dozen. This turns those rows into the round
trips the journal holds - entry and exit averaged over their fills, entered at the first fill,
exited at the last - and refuses to guess where the rows don't say what happened.

  parse(text)   -> broker, fills, skipped     columns found by header, not by position
  match(fills)  -> trades, open, ambiguous    oldest-first position accounting per symbol

Pure: no database, no network. The router adds dedupe (fingerprints of already-imported fills)
and writes trades through the journal's normal create path.

Zerodha's Console tradebook is the reference format. Groww, Upstox and Angel One exports are read
through the same header aliases; a file whose headers don't cover the required fields is rejected
with the headers it does have, never half-parsed.
"""
import csv
import hashlib
import io
import re
from datetime import datetime

from app.core.config import IST

# canonical field -> header spellings seen across brokers (compared after _norm)
ALIASES = {
    "symbol": ["symbol", "tradingsymbol", "trading symbol", "scrip", "scrip name", "stock symbol", "script name"],
    "side": ["trade type", "side", "buy sell", "transaction type", "type", "buy or sell"],
    "quantity": ["quantity", "qty", "traded qty", "trade quantity", "trade qty"],
    "price": ["price", "trade price", "rate", "traded price", "avg price", "average price"],
    "time": ["order execution time", "trade time", "execution date and time", "execution time",
             "trade date time", "date and time", "order time"],
    "date": ["trade date", "date", "order date"],
    "trade_id": ["trade id", "trade no", "trade number", "trade num", "trade ref"],
    "order_id": ["order id", "order no", "order number", "exchange order id", "exchange order no"],
    "segment": ["segment", "instrument type", "product type"],
    "exchange": ["exchange", "exch"],
}
REQUIRED = ("symbol", "side", "quantity", "price")
# distinctive headers -> broker, checked in order
SIGNATURES = [
    ("zerodha", {"order execution time", "trade type", "auction"}),
    ("groww", {"execution date and time"}),
    ("upstox", {"trade num"}),
    ("angelone", {"buy sell", "trade no"}),
]
# Segment values that are cash equity. Anything else (F&O, currency, commodity) is skipped and
# counted - those need lots, expiries and strikes, which the equity journal doesn't model yet.
EQUITY_SEGMENTS = {"", "eq", "equity", "cash", "nse eq", "bse eq", "cm", "delivery", "intraday", "cnc", "mis"}
TIME_FORMATS = ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S",
                "%d-%b-%Y %H:%M:%S", "%d %b %Y, %I:%M %p", "%d %b %Y %I:%M %p", "%d-%m-%Y %H:%M",
                "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y"]


class TradebookError(ValueError):
    """The file can't be read as a tradebook - the message says which columns were missing."""


def _norm(h):
    return re.sub(r"[^a-z0-9]+", " ", (h or "").lower()).strip()


def _time(value, day=None):
    """An IST datetime from the broker's timestamp, or from a bare time joined to the trade date."""
    v = (value or "").strip()
    if day and v and re.fullmatch(r"\d{1,2}:\d{2}(:\d{2})?", v):
        v = f"{day.strip()} {v if v.count(':') == 2 else v + ':00'}"
    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=IST)
        except ValueError:
            continue
    return None


def _number(v):
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


def _symbol(v):
    return re.sub(r"-(EQ|BE|BZ|SM|ST)$", "", (v or "").strip().upper())


def fingerprint(f):
    """A fill's identity across re-imports: the broker's own trade id when it gives one, else a hash
    of what the row says (two genuinely identical fills in one second would collapse - acceptable)."""
    if f.get("trade_id"):
        return f"{f['broker']}:{f['trade_id']}:{f['side']}"
    raw = f"{f['broker']}|{f['symbol']}|{f['side']}|{f['quantity']}|{f['price']}|{f['at'].isoformat()}"
    return f"{f['broker']}:h:{hashlib.sha1(raw.encode()).hexdigest()[:16]}"


def parse(text):
    """(broker, fills, skipped) from a tradebook CSV. `skipped` counts rows left out, by reason."""
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    # some exports put a title block above the table: the header is the first row naming a symbol
    start = next((i for i, r in enumerate(rows) if any(_norm(c) in ALIASES["symbol"] for c in r)), None)
    if start is None:
        raise TradebookError("no header row with a symbol column was found")
    headers = [_norm(c) for c in rows[start]]
    col = {}
    for field, names in ALIASES.items():
        for name in names:
            if name in headers:
                col[field] = headers.index(name)
                break
    missing = [f for f in REQUIRED if f not in col] + ([] if "time" in col or "date" in col else ["time or date"])
    if missing:
        raise TradebookError(f"missing column(s): {', '.join(missing)}. Found: {', '.join(h for h in headers if h)}")
    hset = set(headers)
    broker = next((b for b, sig in SIGNATURES if sig <= hset), "generic")

    fills, skipped = [], {}
    skip = lambda why: skipped.__setitem__(why, skipped.get(why, 0) + 1)  # noqa: E731
    for r in rows[start + 1:]:
        if not any(c.strip() for c in r):
            continue
        get = lambda f: r[col[f]].strip() if f in col and col[f] < len(r) else ""  # noqa: E731
        if _norm(get("segment")) not in EQUITY_SEGMENTS:
            skip("not cash equity (F&O, currency or commodity)")
            continue
        side = _norm(get("side"))
        side = "buy" if side in ("buy", "b", "bought") else "sell" if side in ("sell", "s", "sold") else None
        qty, price = _number(get("quantity")), _number(get("price"))
        at = _time(get("time"), get("date")) or _time(get("date"))
        symbol = _symbol(get("symbol"))
        if not (symbol and side and qty and qty > 0 and price and price > 0 and at):
            skip("unreadable row (missing side, quantity, price or time)")
            continue
        fill = {"broker": broker, "symbol": symbol, "side": side, "quantity": qty, "price": price, "at": at,
                "trade_id": get("trade_id") or None, "order_id": get("order_id") or None,
                "exchange": get("exchange").upper() or None}
        fill["fingerprint"] = fingerprint(fill)
        fills.append(fill)
    return broker, fills, skipped


def _avg(legs):
    q = sum(x["quantity"] for x in legs)
    return round(sum(x["quantity"] * x["price"] for x in legs) / q, 4) if q else None


def _trade(direction, entries, exits):
    return {
        "symbol": entries[0]["symbol"], "direction": direction,
        "quantity": sum(x["quantity"] for x in entries),
        "entry_price": _avg(entries), "exit_price": _avg(exits) if exits else None,
        "entried_at": entries[0]["at"], "exited_at": exits[-1]["at"] if exits else None,
        "fills": len({x["fingerprint"] for x in entries + exits}),
        "fingerprints": sorted({x["fingerprint"] for x in entries + exits}),
    }


def match(fills):
    """Round trips per symbol, oldest-first: a position opens from flat, adds and partial exits fold
    into its averages, and it's a trade once it's flat again.

    Returns (trades, open, ambiguous):
      trades     closed round trips
      open       positions still held at the end of the file - not imported yet; they come in on a
                 later import once the file covers their exit
      ambiguous  fills the file can't place, each with a reason. A sell from flat is only read as a
                 short when buys later the SAME day cover it (cash-equity shorts are intraday); any
                 other sell from flat most likely closes a position bought before the file starts.
    """
    trades, open_, ambiguous = [], [], []
    by_symbol = {}
    for f in sorted(fills, key=lambda f: (f["at"], f["trade_id"] or "")):
        by_symbol.setdefault(f["symbol"], []).append(f)

    for seq in by_symbol.values():
        pos, direction, entries, exits = 0.0, None, [], []
        for i, f in enumerate(seq):
            signed = f["quantity"] if f["side"] == "buy" else -f["quantity"]
            if pos == 0:
                if f["side"] == "sell":
                    covered = sum(g["quantity"] for g in seq[i + 1:]
                                  if g["side"] == "buy" and g["at"].date() == f["at"].date())
                    if covered < f["quantity"]:
                        ambiguous.append({**f, "reason": "sell with no buy before it in this file - "
                                          "probably closes a position bought earlier; import a range "
                                          "that covers the entry, or log it by hand"})
                        continue
                direction, entries, exits, pos = ("long" if signed > 0 else "short"), [f], [], signed
                continue
            if (pos > 0) == (signed > 0):  # adding to the position
                entries.append(f)
                pos += signed
                continue
            if abs(signed) > abs(pos) + 1e-9:
                ambiguous.append({**f, "reason": f"one fill both closes the {direction} position "
                                  f"({abs(pos):g}) and opens the other way ({abs(signed) - abs(pos):g}) "
                                  "- split it into two rows, or log it by hand"})
                continue
            exits.append(f)
            pos += signed
            if abs(pos) < 1e-9:
                pos = 0.0
                trades.append(_trade(direction, entries, exits))
                entries, exits = [], []
        if pos != 0 and entries:
            open_.append({**_trade(direction, entries, exits), "remaining": abs(pos)})
    trades.sort(key=lambda t: t["entried_at"])
    return trades, open_, ambiguous

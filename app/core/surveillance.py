"""NSE's surveillance lists - ASM (Additional Surveillance Measure, long and short term) and GSM
(Graded Surveillance Measure) - as {symbol: entry}.

A stock lands on these for unusual price/volume moves (ASM) or weak fundamentals with speculative
trading (GSM). The exchange then raises its margin to 100%, narrows its price band or moves it to
trade-for-trade, so a position can get hard to exit. It's a fact to know before entering, not a
verdict - the lists move every day.

Two NSE JSON requests, refreshed once per IST day (NSE updates them before the open) and cached in
local_data/surveillance.json - nothing here touches the database.
"""
import json
import threading
from datetime import datetime
from pathlib import Path

from app.core import scraper
from app.core.config import IST

CACHE = Path("local_data/surveillance.json")
_lock = threading.Lock()
_memo = {"day": None, "data": None}


def parse(asm, gsm):
    """{symbol: {kind, stage, desc}} from /api/reportASM and /api/reportGSM payloads. A stock on more
    than one list keeps every entry, most restrictive first (GSM, then long-term, then short-term)."""
    out = {}

    def add(sym, kind, stage, desc):
        if sym:
            out.setdefault(sym, []).append({"kind": kind, "stage": stage, "desc": desc})

    for r in gsm or []:
        add(r.get("symbol"), "GSM", r.get("gsmStage"), r.get("survDesc"))
    for key, kind in (("longterm", "LTASM"), ("shortterm", "STASM")):
        for r in ((asm or {}).get(key) or {}).get("data") or []:
            add(r.get("symbol"), kind, r.get("asmSurvIndicator"), r.get("survDesc"))
    return out


def label(entries):
    """The short badge text: 'GSM LVIII', 'LT-ASM Stage I', ... joined."""
    names = {"GSM": "GSM", "LTASM": "LT-ASM", "STASM": "ST-ASM"}
    return " · ".join(f"{names[e['kind']]} {e['stage'] or ''}".strip() for e in entries)


def current():
    """Today's lists {as_of, stocks}. Fetched at most once per IST day; when NSE can't be reached,
    the last cached copy is served (a day-old list beats none) with its own as_of."""
    today = datetime.now(IST).date().isoformat()
    with _lock:
        if _memo["day"] == today:
            return _memo["data"]
        cached = json.loads(CACHE.read_text()) if CACHE.exists() else None
        if cached and cached.get("as_of") == today:
            data = cached
        else:
            try:
                data = {"as_of": today, "stocks": parse(scraper._nse_json("/api/reportASM"),
                                                        scraper._nse_json("/api/reportGSM"))}
                CACHE.parent.mkdir(parents=True, exist_ok=True)
                CACHE.write_text(json.dumps(data))
            except Exception:
                if not cached:
                    raise
                data = cached
        _memo.update(day=today, data=data)
        return data

"""Self-check for the shareholding change classifier. Plain asserts, no framework, no network:

    .venv/bin/python tests/shareholding.selfcheck.py

The cases are real filings, not invented ones. The AJOONI pair below is the whole reason the module
stores share counts instead of percentages, so it is the first thing checked.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import date

from app.core import shareholding as sh


def filing(promoter_pct, promoter_shares=None, public_shares=None, total_shares=None,
           promoter_holders=None, public_holders=None):
    return {
        "promoter_pct": promoter_pct,
        "promoter_shares": promoter_shares,
        "public_shares": public_shares,
        "total_shares": total_shares,
        "promoter_holders": promoter_holders,
        "public_holders": public_holders,
    }


# --- the case the module exists for -------------------------------------------------------------
# AJOONI, 30-JUN-2026 -> 12-AUG-2026, as filed. Promoter +3.64pp and the public sold NOTHING: nine
# million new shares were created for a sixth promoter entity. Percentages alone call this
# accumulation; it is the opposite.
ajooni_before = filing(26.89, 46_324_766, 125_918_832, 172_243_598, 5, 60_670)
ajooni_after = filing(30.53, 55_324_766, 125_918_832, 181_243_598, 6, 60_164)
verdict = sh.classify(ajooni_before, ajooni_after)
assert verdict["verdict"] == "issued_to_promoter", verdict
assert verdict["organic"] is False
assert verdict["promoter_pp"] == 3.64
assert verdict["promoter_shares_delta"] == 9_000_000
assert verdict["public_shares_delta"] == 0, "the public did not sell a single share"
assert verdict["total_shares_delta"] == 9_000_000

# The same percentage move, done the honest way: no new shares, the promoter bought what the public
# sold. Identical promoter_pp, opposite meaning - which is the point.
organic_after = filing(30.53, 55_324_766, 116_918_832, 172_243_598, 5, 59_900)
organic = sh.classify(ajooni_before, organic_after)
assert organic["verdict"] == "organic_buy", organic
assert organic["organic"] is True
assert organic["total_shares_delta"] == 0
assert organic["public_holders_delta"] == -770
assert organic["promoter_pp"] == verdict["promoter_pp"], "same headline move, different mechanism"

# --- the other verdicts --------------------------------------------------------------------------
# Promoter sells into the market: total flat, their count falls.
sell = sh.classify(ajooni_before, filing(24.0, 41_324_766, 130_918_832, 172_243_598, 5, 61_500))
assert sell["verdict"] == "organic_sell" and sell["organic"] is True, sell

# A QIP: new shares, none of them to the promoter, whose percentage falls without them doing
# anything at all.
diluted = sh.classify(ajooni_before, filing(23.0, 46_324_766, 155_000_000, 201_324_766, 5, 62_000))
assert diluted["verdict"] == "diluted" and diluted["organic"] is False, diluted

# Reclassification: shares cross from promoter to public with no new shares AND the promoter entity
# count drops - somebody was re-labelled rather than anybody trading.
reclass = sh.classify(
    filing(45.0, 77_509_619, 94_733_979, 172_243_598, 7, 60_000),
    filing(26.89, 46_324_766, 125_918_832, 172_243_598, 4, 60_003),
)
assert reclass["verdict"] == "reclassification" and reclass["organic"] is False, reclass

# Ordinary quarter, nothing moved.
quiet = sh.classify(ajooni_before, filing(26.89, 46_324_766, 125_918_832, 172_243_598, 5, 60_690))
assert quiet["verdict"] == "no_change", quiet

# A tiny ESOP allotment is not "new shares issued to the promoter": under the flat tolerance it
# reads as the non-event it is.
esop = sh.classify(ajooni_before, filing(26.87, 46_324_766, 126_050_000, 172_374_766, 5, 60_700))
assert esop["verdict"] == "no_change", esop

# --- when the detail isn't there ------------------------------------------------------------------
# Percentages only: the module refuses to guess a mechanism. That refusal IS the feature - a verdict
# invented from percentages is the mistake the whole thing exists to prevent.
thin = sh.classify(filing(26.89), filing(30.53))
assert thin["verdict"] == "detail_missing" and thin["organic"] is None, thin
assert thin["promoter_pp"] == 3.64, "the headline move is still reported"
# ...but a move too small to matter needs no filing read, detail or not.
assert sh.classify(filing(26.89), filing(26.9))["verdict"] == "no_change"

# --- which filings earn an XBRL fetch --------------------------------------------------------------
quarter_end = date(2026, 6, 30)
mid_quarter = date(2026, 8, 12)
assert sh.is_off_cycle(mid_quarter) and not sh.is_off_cycle(quarter_end)

url = "https://nsearchives.nseindia.com/x.xml"
big = {"period_date": quarter_end, "promoter_pct": 30.53, "xbrl_url": url}
small = {"period_date": quarter_end, "promoter_pct": 26.9, "xbrl_url": url}
prev = {"promoter_pct": 26.89}
assert sh.needs_detail(big, prev) is True, "a 3.6pp move is worth the fetch"
assert sh.needs_detail(small, prev) is False, "0.01pp is 2,000 of the 2,500 filings in a quarter"
# An off-cycle filing exists BECAUSE of a capital change, so it is fetched however small it looks.
assert sh.needs_detail({**small, "period_date": mid_quarter}, prev) is True
assert sh.needs_detail(big, None) is True, "the first filing on record seeds the baseline"
assert sh.needs_detail({**big, "xbrl_url": None}, prev) is False, "nothing to fetch"

# --- history windows ------------------------------------------------------------------------------
today = date(2026, 8, 25)
year = sh.windows(1, today)
assert year[0][1] == today, "newest window first - an interrupted seed keeps the useful end"
assert all((b - a).days <= sh.WINDOW_DAYS for a, b in year), "the endpoint refuses wide ranges"
assert year[-1][0] >= today.replace(year=2025, month=8, day=25), "never reaches past the asked range"
assert len(sh.windows(5, today)) > len(year)
assert len(sh.windows(99, today)) == len(sh.windows(sh.MAX_SEED_YEARS, today)), "capped, not refused"
assert len(sh.windows(0, today)) == len(sh.windows(1, today)), "and floored at one year"

# Windows tile without gaps: a filing landing between two of them would never be collected. They
# run newest-first, so each window ends the day before the previous one starts.
for newer, older in zip(year[:-1], year[1:]):
    assert (newer[0] - older[1]).days == 1, (newer, older)

# An explicit span (what the page's range picker sends) tiles the same way, and reads an inverted
# range the way it was obviously meant - the two ends of a date picker are easy to fill in backwards.
span = sh.windows_between(date(2026, 1, 1), today)
assert span[0][1] == today and span[-1][0] == date(2026, 1, 1), span
assert sh.windows_between(today, date(2026, 1, 1)) == span, "from/to swapped is still that range"
assert sh.windows_between(today, today) == [(today, today)], "a single day is one window, not none"
for newer, older in zip(span[:-1], span[1:]):
    assert (newer[0] - older[1]).days == 1, (newer, older)

# --- master row parsing ---------------------------------------------------------------------------
row = {
    "symbol": " ajooni ", "name": "Ajooni Biotech Limited", "isin": "INE637Y01029",
    "date": "12-AUG-2026", "submissionDate": "22-AUG-2026", "recordId": "1717063",
    "pr_and_prgrp": "30.53", "public_val": "69.47", "employeeTrusts": "0", "underlyingDrs": None,
    "revisedData": "N", "xbrl": "https://nsearchives.nseindia.com/x.xml",
}
parsed = sh.parse_master_row(row)
assert parsed["symbol"] == "AJOONI", "symbols are keys elsewhere in the app - trimmed and upper"
assert parsed["period_date"] == mid_quarter and parsed["submission_date"] == date(2026, 8, 22)
assert parsed["promoter_pct"] == 30.53 and parsed["dr_pct"] is None
assert parsed["is_revision"] is False
assert sh.parse_master_row({**row, "revisedData": "Revised"})["is_revision"] is True

# A row with no period, symbol or record id can't be stored or deduped - dropped, not defaulted.
assert sh.parse_master_row({**row, "date": None}) is None
assert sh.parse_master_row({**row, "recordId": None}) is None
assert sh.parse_master_row({**row, "symbol": ""}) is None

# --- revisions, pace and the screener --------------------------------------------------------------
def row(symbol, period, promoter_pct, submission=None, **extra):
    return {
        "symbol": symbol, "company": f"{symbol} Ltd", "period_date": period,
        "submission_date": submission or period, "promoter_pct": promoter_pct,
        "public_pct": round(100 - promoter_pct, 4), "detail_fetched_at": None, **extra,
    }


# A revision restates a period already filed. Treated as its own period it would invent a whole
# quarter of change out of a correction, so the later submission simply replaces the earlier one.
revised = [
    row("ACME", date(2026, 3, 31), 40.0),
    row("ACME", date(2026, 6, 30), 55.0, submission=date(2026, 7, 15)),
    row("ACME", date(2026, 6, 30), 41.0, submission=date(2026, 7, 28)),
]
periods = [f["period_date"] for f in sh.latest_per_period(revised)]
assert periods == [date(2026, 3, 31), date(2026, 6, 30)], periods
changes = sh.series_changes(revised)
assert len(changes) == 1 and changes[0]["promoter_pp"] == 1.0, changes

# Pace: the same +3pp, arriving two different ways. This is the distinction the feature is for.
gradual = [row("SLOW", date(2025, 9, 30), 15.0), row("SLOW", date(2025, 12, 31), 15.8),
           row("SLOW", date(2026, 3, 31), 16.6), row("SLOW", date(2026, 6, 30), 18.0)]
jump = [row("FAST", date(2025, 9, 30), 15.0), row("FAST", date(2025, 12, 31), 15.05),
        row("FAST", date(2026, 3, 31), 15.1), row("FAST", date(2026, 6, 30), 18.0)]
slow_pace = sh.pace(sh.series_changes(gradual), 4)
fast_pace = sh.pace(sh.series_changes(jump), 4)
assert slow_pace["total_pp"] == 3.0 and fast_pace["total_pp"] == 3.0, (slow_pace, fast_pace)
assert slow_pace["gradual"] is True, slow_pace
assert fast_pace["gradual"] is False, "one filing carried 97% of the move"
assert sh.pace([], 4)["total_pp"] is None
assert sh.pace(sh.series_changes([row("FLAT", date(2026, 3, 31), 15.0),
                                  row("FLAT", date(2026, 6, 30), 15.1)]), 4)["gradual"] is None

# The screener sorts what to read first, and says which bucket each name is in.
detailed = [
    {**row("ISSUE", date(2026, 3, 31), 26.89, detail_fetched_at="x"),
     "promoter_shares": 46_324_766, "public_shares": 125_918_832, "total_shares": 172_243_598,
     "promoter_holders": 5, "public_holders": 60_670},
    {**row("ISSUE", date(2026, 6, 30), 30.53, detail_fetched_at="x"),
     "promoter_shares": 55_324_766, "public_shares": 125_918_832, "total_shares": 181_243_598,
     "promoter_holders": 6, "public_holders": 60_164},
]
screener = sh.screener_rows(detailed + gradual + [row("QUIET", date(2026, 3, 31), 50.0),
                                                  row("QUIET", date(2026, 6, 30), 50.0)])
by_symbol = {r["symbol"]: r for r in screener}
assert screener[0]["symbol"] == "ISSUE", "the biggest move is read first"
assert by_symbol["ISSUE"]["flag"] == "verify", by_symbol["ISSUE"]
assert by_symbol["ISSUE"]["last_change"]["verdict"] == "issued_to_promoter"
assert by_symbol["SLOW"]["flag"] == "verify", "no share counts yet - unverified is not organic"
assert by_symbol["QUIET"]["flag"] == "quiet"
assert by_symbol["SLOW"]["window"]["gradual"] is True, "the pace still reads without the detail"
assert by_symbol["QUIET"]["has_detail"] is False

print("ok - shareholding: AJOONI mechanism split, verdicts, detail gating, windows, master parsing, screener")

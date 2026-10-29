"""ASM/GSM parsing, delivery % parsing and stats, and the two microcap flags they feed.
Run: python tests/surveillance.selfcheck.py"""
from app.core import bhavcopy, microcap, surveillance

# --- surveillance.parse: every list, GSM first, a stock on two lists keeps both
asm = {
    "longterm": {"data": [{"symbol": "AAA", "asmSurvIndicator": "Stage I", "survDesc": "LTASM I"}]},
    "shortterm": {"data": [{"symbol": "BBB", "asmSurvIndicator": "Stage II", "survDesc": "STASM II"},
                           {"symbol": "AAA", "asmSurvIndicator": "Stage I", "survDesc": "STASM I"}]},
}
gsm = [{"symbol": "AAA", "gsmStage": "LVIII", "survDesc": "GSM 0"}, {"symbol": None, "gsmStage": "I"}]
s = surveillance.parse(asm, gsm)
assert set(s) == {"AAA", "BBB"}, s
assert [e["kind"] for e in s["AAA"]] == ["GSM", "LTASM", "STASM"], s["AAA"]
assert surveillance.label(s["BBB"]) == "ST-ASM Stage II"
assert surveillance.label(s["AAA"]).startswith("GSM LVIII · LT-ASM Stage I")
assert surveillance.parse(None, None) == {}

# --- delivery: NSE's file pads with spaces; "-" and other series are skipped
raw = (
    "SYMBOL, SERIES, DATE1, TTL_TRD_QNTY, DELIV_QTY, DELIV_PER\n"
    "ABC, EQ, 23-Oct-2026, 100, 41, 40.92\n"
    "XYZ, BE, 23-Oct-2026, 10, 10, 100.00\n"
    "BND, N1, 23-Oct-2026, 5, 5, 100.00\n"
    "ZZZ, EQ, 23-Oct-2026, 0, -, -\n"
)
d = bhavcopy.parse_delivery(raw)
assert d == {"ABC": 40.92, "XYZ": 100.0}, d

st = bhavcopy.delivery_stats([50.0] * 20 + [10.0])
assert st == {"deliv_pct": 10.0, "deliv_avg20": 50.0}, st
assert bhavcopy.delivery_stats([30.0]) == {"deliv_pct": 30.0, "deliv_avg20": None}
assert bhavcopy.delivery_stats([]) == {"deliv_pct": None, "deliv_avg20": None}

# --- microcap red flags
assert "ST-ASM Stage II" in microcap.red_flags({"surveillance": "ST-ASM Stage II"})
assert microcap.red_flags({"deliv_avg20": 12.5}) == ["delivery 12.5% (20d)"]
assert microcap.red_flags({"deliv_avg20": 20.0}) == [], "threshold is strictly below"
rows = microcap.build([{"symbol": "BBB", "market_capitalization": 500.0}],
                      [{"symbol": "BBB", "rs": 80, "deliv_pct": 15.0, "deliv_avg20": 18.0}], {},
                      {"BBB": "ST-ASM Stage II"})
assert rows[0]["deliv_pct"] == 15.0 and rows[0]["surveillance"] == "ST-ASM Stage II", rows[0]
assert len(rows[0]["flags"]) == 2, rows[0]["flags"]
print("PASSED: surveillance + delivery selfcheck")

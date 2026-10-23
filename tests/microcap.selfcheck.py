"""app/core/microcap.py's pure half: screener row normalising, the shareholding trend, red flags and
the join. Run: python tests/microcap.selfcheck.py"""
from datetime import date

from app.core import microcap as m

# --- normalise: our names, first matching column, non-numbers dropped
r = m.normalise({"symbol": "ABC", "name": "Abc Ltd", "url": "u", "current_price": 120.5,
                 "market_capitalization": 850.0, "return_on_capital_employed": "n/a", "roce_pct": 22.0})
assert r["price"] == 120.5 and r["mcap_cr"] == 850.0
assert r["roce"] == 22.0, "falls through to the next candidate when the first isn't a number"
assert r["pledge_pct"] is None

# --- ownership: last quarterly vs four quarters earlier; off-cycle counted within 2y; revisions ignored
F = lambda d, p, rev=False: {"symbol": "ABC", "period_date": d, "promoter_pct": p, "is_revision": rev}  # noqa: E731
filings = [F(date(2025, 6, 30), 60), F(date(2025, 9, 30), 59), F(date(2025, 12, 31), 58),
           F(date(2026, 2, 14), 57.5), F(date(2026, 3, 31), 57), F(date(2026, 6, 30), 55),
           F(date(2026, 6, 30), 10, rev=True)]
o = m.ownership(filings, today=date(2026, 10, 1))["ABC"]
assert o["promoter_pct"] == 55, o
assert o["promoter_chg_4q"] == -5.0, o  # 55 now vs 60 at 2025-06-30
assert o["off_cycle_2y"] == 1, o
assert m.ownership([F(date(2026, 6, 30), 50)])["ABC"]["promoter_chg_4q"] is None

# --- red flags: each fires on its own fact, none on missing data
assert m.red_flags({}) == []
fl = m.red_flags({"pledge_pct": 12, "promoter_chg_4q": -3, "cfo_cr": 2, "np_last_year_cr": 10,
                  "debt_equity": 1.4, "off_cycle_2y": 2, "avg_value_cr": 0.2})
assert len(fl) == 6, fl
assert m.red_flags({"cfo_cr": -5, "np_last_year_cr": -2}) == [], "loss-making: CFO vs profit is meaningless"
assert m.red_flags({"promoter_chg_4q": -1.9, "avg_value_cr": 0.5}) == []

# --- build: joins strength + ownership, RS-sorted with unrated last, BSE-only rows kept
rows = m.build(
    [{"symbol": "ABC", "market_capitalization": 900.0, "promoter_holding": 70.0},
     {"symbol": "XYZ", "market_capitalization": 300.0, "promoter_holding": 40.0},
     {"symbol": None, "bse_code": "538786", "market_capitalization": 150.0}],
    [{"symbol": "XYZ", "rs": 91, "avg_value_cr": 2.0}, {"symbol": "ABC", "rs": 40, "avg_value_cr": 0.1}],
    {"ABC": {"promoter_pct": 55, "promoter_chg_4q": -5.0, "off_cycle_2y": 0}},
)
assert [r["symbol"] for r in rows] == ["XYZ", "ABC", None], [r["symbol"] for r in rows]
abc = rows[1]
assert abc["promoter_pct"] == 55, "NSE filing wins over screener's figure"
assert rows[0]["promoter_pct"] == 40.0, "screener's figure when there's no filing"
assert "illiquid" in abc["flags"] and any("promoter" in f for f in abc["flags"])
assert rows[2]["bse_code"] == "538786" and rows[2]["rs"] is None

assert rows[0]["key"] == "XYZ" and rows[2]["key"] == "538786"

# --- thesis breaches: only limits that were set, only on numbers that exist
T = {"min_roce": 15, "max_pe": 30, "max_promoter_drop": 2, "baseline": {"promoter_pct": 60}}
assert m.thesis_breaches(T, {"roce": 18, "pe": 25, "promoter_pct": 59}) == []
b = m.thesis_breaches(T, {"roce": 12, "pe": 40, "promoter_pct": 57})
assert len(b) == 3, b
assert m.thesis_breaches({"min_roce": 15}, {"roce": None}) == []
assert m.thesis_breaches(T, None) == ["no longer in the microcap band"]

# --- quarter diff: fires when the latest-quarter numbers move, silent otherwise
p = {"sales_qtr_cr": 50, "np_qtr_cr": 5, "qtr_sales_yoy": 10, "qtr_profit_yoy": 20}
assert m.quarter_diff(p, dict(p)) is None
d = m.quarter_diff(p, {**p, "sales_qtr_cr": 60, "np_qtr_cr": 7, "qtr_sales_yoy": 25})
assert d == {"sales_qtr_cr": [50, 60], "np_qtr_cr": [5, 7], "qtr_sales_yoy": [10, 25]}, d
assert m.quarter_diff(p, {**p, "qtr_sales_yoy": 11}) is None, "a YoY tweak alone isn't a new quarter"
assert m.quarter_diff(None, p) is None

assert m.since_baseline({"baseline": {"roce": 20}}, {"roce": 16})["roce"] == [20, 16]

assert "Market Capitalization > 100" in m.QUERY and "Market Capitalization < 2000" in m.QUERY
print("PASSED: microcap selfcheck")

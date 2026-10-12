"""Self-check for matching company names (ET sector members) to stocks_master symbols. Pure.

    .venv/bin/python tests/name_match.selfcheck.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.stocks_master import match_symbol, name_keys, symbol_index

MASTER = [
    {"symbol": "LTTS", "name": "L&T Technology Services Limited", "exchange": "NSE"},
    {"symbol": "LALPATHLAB", "name": "Dr. Lal Path Labs Ltd.", "exchange": "NSE"},
    {"symbol": "SHREECEM", "name": "SHREE CEMENT LIMITED", "exchange": "NSE"},
    {"symbol": "BERGEPAINT", "name": "Berger Paints (I) Limited", "exchange": "NSE"},
    {"symbol": "SAIL", "name": "Steel Authority of India Limited", "exchange": "NSE"},
    {"symbol": "RELINFRA", "name": "Reliance Infrastructure Ltd", "exchange": "BSE"},
    # the same company on both boards: NSE wins
    {"symbol": "APOLLOTYRE", "name": "Apollo Tyres Limited", "exchange": "NSE"},
    {"symbol": "APOLLOTY", "name": "Apollo Tyres Ltd.", "exchange": "BSE"},
    # two different companies with the same key: ambiguous, so neither
    {"symbol": "ABC1", "name": "ABC Industries Limited", "exchange": "NSE"},
    {"symbol": "ABC2", "name": "A.B.C. Industries Ltd", "exchange": "NSE"},
]
index = symbol_index(MASTER)
m = lambda *names: match_symbol(index, *names)  # noqa: E731

assert name_keys("L&T Technology Services Limited") == name_keys("lt technology services ltd")
assert m("lt-technology-services-ltd") == "LTTS"
assert m("dr-lal-pathlabs-ltd") == "LALPATHLAB", "spacing doesn't matter"
assert m("shree-cements-ltd") == "SHREECEM", "plurals don't matter"
assert m("berger-paints-india-ltd") == "BERGEPAINT", "(I) is India"
assert m("steel-authority-of-india-sail-ltd", "SAIL") == "SAIL", "short name that is the ticker"
assert m("reliance-infrastructure-ltd") == "RELINFRA", "a BSE-only listing still maps"
assert m("apollo-tyres-ltd") == "APOLLOTYRE", "NSE preferred"
assert m("abc-industries-ltd") is None, "ambiguous is unmatched"
assert m("icici-life-insurance-ltd", "ICICI Pru Life") is None, "no guessing"
assert m(None, "") is None
print("ok - name match: punctuation/spacing/plurals/(I), ticker short names, NSE first, ambiguous unmatched")

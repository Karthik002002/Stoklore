"""Self-check for the BSE scrip parser. Plain asserts, no framework, no network:

    .venv/bin/python tests/bse_master.selfcheck.py

The rows below are real ListofScripData payloads, trimmed to the fields the parser reads.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import bse_master as bse

ABB = {
    "SCRIP_CD": "500002", "Scrip_Name": "ABB India Ltd", "Status": "Active", "GROUP": "A",
    "FACE_VALUE": "2.00", "ISIN_NUMBER": "INE117A01022", "scrip_id": "ABB",
    "Issuer_Name": "ABB India Limited", "Segment": "Equity",
}

row = bse.parse_scrip(ABB)
assert row["symbol"] == "ABB", "the trading symbol, not the numeric code - it's what people type"
assert row["bse_code"] == "500002", "and the code is kept, because BSE's own APIs take only that"
assert row["isin"] == "INE117A01022", "the ISIN is what merges this onto its NSE twin"
assert row["exchange"] == "BSE"
assert row["board"] == "MAIN" and row["face_value"] == 2.0
# Issuer_Name over Scrip_Name: the legal name is the spelling NSE's CSVs use, so a merged row
# doesn't flip between "ABB India Ltd" and "ABB India Limited" on every import.
assert row["name"] == "ABB India Limited"
assert bse.parse_scrip({**ABB, "Issuer_Name": None})["name"] == "ABB India Ltd", "falls back"

# BSE's SME groups map onto the master's existing board flag, the same distinction NSE's SM/ST
# series draws - so one column describes both exchanges' SME platforms.
for group in ("M", "MT", "MS"):
    assert bse.parse_scrip({**ABB, "GROUP": group})["board"] == "SME", group
for group in ("A", "B", "T", "X"):
    assert bse.parse_scrip({**ABB, "GROUP": group})["board"] == "MAIN", group

# Symbols are upper-cased and trimmed: they are keys everywhere else in the app.
assert bse.parse_scrip({**ABB, "scrip_id": " abb "})["symbol"] == "ABB"

# Unkeyable rows are dropped rather than defaulted - a scrip with no symbol or no code cannot be
# stored, merged or looked up later.
assert bse.parse_scrip({**ABB, "scrip_id": ""}) is None
assert bse.parse_scrip({**ABB, "SCRIP_CD": None}) is None

# A scrip with no ISIN still parses - it simply can't merge, so it lands as its own row.
assert bse.parse_scrip({**ABB, "ISIN_NUMBER": ""})["isin"] is None

# A junk face value is None, not a crash and not 0.0 (which would read as a real face value).
assert bse.parse_scrip({**ABB, "FACE_VALUE": "-"})["face_value"] is None

print("ok - bse_master: symbol/code keys, ISIN, SME groups, name preference, unkeyable rows")

"""NSE movers rows: quantity and turnover come as display text ('171.99 L', '431.65 Cr').
Run: python tests/movers.selfcheck.py"""
from app.core.scraper import _mover_row, _nse_amount

assert _nse_amount("171.99 L") == 171.99e5
assert _nse_amount("431.65 Cr", 1e5) == 43165.0
assert _nse_amount("1,234.5") == 1234.5
assert _nse_amount(12.5) == 12.5  # the old numeric feed passes through
assert _nse_amount(None) is None
assert _nse_amount("-") is None and _nse_amount("12 XYZ") is None

row = _mover_row({"symbol": "ITI", "ltp": 259.14, "prev_price": 215.95, "perChange": 20,
                  "trade_quantity": "171.99 L", "turnover": "431.65 Cr", "ca_purpose": "-"})
assert row["trade_quantity"] == 17199000.0, row
assert row["turnover"] == 43165.0, row  # ₹ lakh, what the UI divides by 100 for ₹Cr
assert row["change"] == 43.19 and row["ca_purpose"] is None, row
print("movers selfcheck passed")

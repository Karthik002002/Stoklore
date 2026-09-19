"""The dashboard's journal numbers must equal the journal's own.

app/services/journal_math.py re-implements P&L, costs, R and sessions from the frontend's
manualTrades.ts / tradeCosts.ts (the journal computes them in the browser; dashboards query on the
server). This runs both on the same trades - the TypeScript through node - and fails on any
difference, so a formula changed on one side can't quietly drift from the other.

    .venv/bin/python tests/journal_math.selfcheck.py
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import journal_math as jm  # noqa: E402

PER_SHARE = {"slippage_value": 0.05, "slippage_type": "per_share", "brokerage_flat": 20,
             "brokerage_pct": 0.03, "other_charges_pct": 0.1}
BPS = {"slippage_value": 5, "slippage_type": "bps", "brokerage_flat": 0, "brokerage_pct": 0, "other_charges_pct": 0.025}
FREE = {"slippage_value": 0, "slippage_type": "per_share", "brokerage_flat": 0, "brokerage_pct": 0, "other_charges_pct": 0}


def trade(**kw):
    return {"direction": "long", "quantity": 10, "entry_price": 100.0, "exit_price": None, "stop_loss": None,
            "target": None, "ideal_risk_amount": None, "traded_at": "2026-09-15T10:00:00+05:30", **kw}


CASES = [
    # (trade, account) - each one pins a branch or an edge of the arithmetic.
    (trade(exit_price=112.5, stop_loss=95, target=120, ideal_risk_amount=50), PER_SHARE),   # long winner, planned RR
    (trade(direction="short", exit_price=91.2, stop_loss=104, ideal_risk_amount=40), BPS),  # short winner, realised RR
    (trade(direction="short", exit_price=106.4, stop_loss=104), PER_SHARE),                  # short loser past its stop
    (trade(exit_price=None, stop_loss=97), PER_SHARE),                                       # open: entry side costed only
    (trade(exit_price=101.0, stop_loss=100.0), None),                                        # zero stop distance; no account
    (trade(exit_price=100.015, quantity=100), FREE),                                         # inside the neutral band
    # 0.125 x 100 is exactly 12.5: JS rounds it to 13, Python's round() to 12. The mirror must say 13.
    (trade(entry_price=100.0, exit_price=100.125, quantity=1), FREE),
    (trade(direction="short", entry_price=100.0, exit_price=100.125, quantity=1), FREE),     # ... and its negative
    (trade(exit_price=250.0, quantity=0), PER_SHARE),                                        # no quantity: result unknown
    (trade(exit_price=1343.6, entry_price=1394.0, quantity=3, stop_loss=1351.0), FREE),      # a real paper trade
    (trade(traded_at="2026-09-15T09:20:00+05:30", exit_price=101), None),                     # Opening
    (trade(traded_at="2026-09-15T14:30:00+05:30", exit_price=101), None),                     # Closing starts at 14:30
    (trade(traded_at="2026-09-15T15:30:00+05:30", exit_price=101), None),                     # after the close
    (trade(traded_at="2026-09-15T04:00:00+00:00", exit_price=101), None),                     # UTC in, IST session out
]

ts = json.loads(subprocess.run(
    ["node", str(Path(__file__).with_name("journal_math.parity.mjs")),
     json.dumps([{"trade": t, "account": a} for t, a in CASES])],
    capture_output=True, text=True, check=True,
    # sessionFor reads the machine's clock zone; the journal is used in IST.
    env={**os.environ, "TZ": "Asia/Kolkata"},
).stdout)

py = [{
    "pnl": jm.pnl(t),
    "return_pct": jm.return_pct(t),
    "planned_rr": jm.planned_rr(t),
    "realised_rr": None if jm.planned_rr(t) is not None else jm.realised_rr(t),
    "r_multiple": jm.r_multiple(t),
    "risk_amount": jm.risk_amount(t),
    "auto_result": jm.auto_result(t),
    "costs": jm.costs(t, a),
    "net_pnl": jm.net_pnl(t, a),
    "net_return_pct": jm.net_return_pct(t, a),
    "session": jm.session(t["traded_at"]),
} for t, a in CASES]

mismatches = [
    (i, key, ts[i][key], py[i][key])
    for i in range(len(CASES))
    for key in ts[i]
    if not (ts[i][key] == py[i][key] or (isinstance(ts[i][key], (int, float)) and isinstance(py[i][key], (int, float))
                                         and abs(ts[i][key] - py[i][key]) < 1e-9))
]
for i, key, t_val, p_val in mismatches:
    print(f"case {i} {key}: TypeScript {t_val!r} != Python {p_val!r}")
assert not mismatches, f"{len(mismatches)} journal numbers differ between the dashboard and the journal"

# Pinned outright too, so the check can't pass by both sides being wrong the same way.
assert py[0]["pnl"] == 125.0 and py[0]["planned_rr"] == 4.0 and py[0]["r_multiple"] == 2.5
assert py[2]["realised_rr"] == -1.6 and py[2]["auto_result"] == "loss"
assert py[3]["pnl"] is None and py[3]["costs"] is not None, "an open trade is charged its entry side"
assert py[4]["costs"] is None and py[4]["net_pnl"] == py[4]["pnl"], "no account: unknown costs, net = gross"
assert py[5]["auto_result"] == "neutral"
assert py[6]["pnl"] == 0.13 and py[7]["pnl"] == -0.12, "halves round toward +infinity, the way the browser does"
assert py[8]["auto_result"] is None
assert [p["session"] for p in py[10:14]] == ["Opening", "Closing", "After hours", "Opening"]

print(f"ok - journal math: {len(CASES)} trades, every number identical to the journal's TypeScript")

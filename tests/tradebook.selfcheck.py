"""app/core/tradebook.py: tradebook CSV -> fills -> round trips. Run: python tests/tradebook.selfcheck.py"""
from app.core import tradebook as tb

ZERODHA = """symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time
TCS,INE467B01029,2026-10-01,NSE,EQ,EQ,buy,false,3,4000.00,1001,9001,2026-10-01T09:20:01
TCS,INE467B01029,2026-10-01,NSE,EQ,EQ,buy,false,7,4002.00,1002,9001,2026-10-01T09:20:02
TCS,INE467B01029,2026-10-03,NSE,EQ,EQ,sell,false,4,4100.00,1003,9002,2026-10-03T11:00:00
TCS,INE467B01029,2026-10-06,NSE,EQ,EQ,sell,false,6,4150.00,1004,9003,2026-10-06T14:00:00
INFY,INE009A01021,2026-10-02,NSE,EQ,EQ,sell,false,10,1500.00,2001,8001,2026-10-02T10:00:00
INFY,INE009A01021,2026-10-02,NSE,EQ,EQ,buy,false,10,1490.00,2002,8002,2026-10-02T14:30:00
WIPRO,INE075A01022,2026-10-02,NSE,EQ,EQ,sell,false,5,300.00,3001,7001,2026-10-02T10:00:00
HDFCBANK,INE040A01034,2026-10-05,NSE,EQ,EQ,buy,false,2,1700.00,4001,6001,2026-10-05T10:00:00
HDFCBANK,INE040A01034,2026-10-05,NSE,EQ,EQ,sell,false,5,1710.00,4002,6002,2026-10-05T11:00:00
ITC,INE154A01025,2026-10-07,NSE,EQ,EQ,buy,false,100,450.00,5001,5501,2026-10-07T10:00:00
ITC,INE154A01025,2026-10-08,NSE,EQ,EQ,sell,false,40,460.00,5002,5502,2026-10-08T10:00:00
NIFTY26OCTFUT,,2026-10-07,NFO,FO,,buy,false,75,25000.00,6001,4401,2026-10-07T10:00:00
"""

broker, fills, skipped = tb.parse(ZERODHA)
assert broker == "zerodha", broker
assert len(fills) == 11, len(fills)
assert skipped == {"not cash equity (F&O, currency or commodity)": 1}, skipped
assert fills[0]["at"].isoformat() == "2026-10-01T09:20:01+05:30", fills[0]["at"]
assert len({f["fingerprint"] for f in fills}) == 11, "every fill has its own fingerprint"

trades, open_, ambiguous = tb.match(fills)
by = {t["symbol"]: t for t in trades}
assert set(by) == {"TCS", "INFY"}, list(by)

tcs = by["TCS"]  # 2 partial buys + 2 partial sells -> one long trade
assert (tcs["direction"], tcs["quantity"], tcs["fills"]) == ("long", 10, 4), tcs
assert tcs["entry_price"] == 4001.4, tcs["entry_price"]  # (3*4000 + 7*4002) / 10
assert tcs["exit_price"] == 4130.0, tcs["exit_price"]  # (4*4100 + 6*4150) / 10
assert tcs["entried_at"].day == 1 and tcs["exited_at"].day == 6

infy = by["INFY"]  # sold first, bought back the same day -> an intraday short
assert (infy["direction"], infy["entry_price"], infy["exit_price"]) == ("short", 1500.0, 1490.0), infy

reasons = {a["symbol"]: a["reason"] for a in ambiguous}
assert set(reasons) == {"WIPRO", "HDFCBANK"}, reasons
assert "no buy before it" in reasons["WIPRO"], "a sell with no same-day cover isn't guessed as a short"
assert "opens the other way" in reasons["HDFCBANK"], "a flipping fill is held for review"

assert len(open_) == 2, open_  # HDFCBANK (its flip held back) and ITC (60 of 100 still held)
itc = next(o for o in open_ if o["symbol"] == "ITC")
assert itc["remaining"] == 60 and itc["quantity"] == 100, itc

# re-parsing the same file gives the same fingerprints (that's what dedupe relies on)
assert [f["fingerprint"] for f in tb.parse(ZERODHA)[1]] == [f["fingerprint"] for f in fills]

# another broker's headers: bare time joined to the trade date, -EQ suffix stripped, side as B/S
UPSTOX = """Date,Company,Scrip Code,Exchange,Segment,Trade Num,Trade Time,Side,Quantity,Price
02-10-2026,Reliance Industries,RELIANCE-EQ,NSE,EQ,77,09:31,B,5,"2,900.50"
02-10-2026,Reliance Industries,RELIANCE-EQ,NSE,EQ,78,15:01:10,S,5,"2,910.00"
"""
b2, f2, _ = tb.parse(UPSTOX.replace("Scrip Code", "Symbol"))
assert b2 == "upstox" and [f["symbol"] for f in f2] == ["RELIANCE", "RELIANCE"], (b2, f2)
assert f2[0]["price"] == 2900.5 and f2[0]["at"].hour == 9 and f2[0]["at"].minute == 31, f2[0]
assert tb.match(f2)[0][0]["exit_price"] == 2910.0

# a file without the needed columns is refused with what it does have
try:
    tb.parse("symbol,amount\nTCS,100\n")
    raise AssertionError("should have refused")
except tb.TradebookError as e:
    assert "side" in str(e) and "Found: symbol, amount" in str(e), e

print("PASSED: tradebook selfcheck")

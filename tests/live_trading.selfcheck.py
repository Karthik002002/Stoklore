"""Self-check for the live-trading logic that decides things BEFORE any money moves. Plain asserts,
no framework, no network, no credentials:

    .venv/bin/python tests/live_trading.selfcheck.py

Everything checked here is a pure function, which is the point: the order payload, every guardrail
and every reading of the broker's answer are decided without a socket, so they can be tested
without an account. The one thing this cannot check is Dhan actually accepting a payload - that
needs the sandbox (developer.dhanhq.co) and a human watching.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime

from app.core import alerts, dhan_orders as do

# --- the instrument map ----------------------------------------------------------------------------
# The series filter is the safety-critical part: NSE puts bonds, SME scrips and cash equities in
# one file under one instrument name, and routing an order to the wrong one is a real trade.
MASTER_CSV = """SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_INSTRUMENT_NAME,SEM_EXPIRY_CODE,SEM_TRADING_SYMBOL,SEM_LOT_UNITS,SEM_CUSTOM_SYMBOL,SEM_EXPIRY_DATE,SEM_STRIKE_PRICE,SEM_OPTION_TYPE,SEM_TICK_SIZE,SEM_EXPIRY_FLAG,SEM_EXCH_INSTRUMENT_TYPE,SEM_SERIES,SM_SYMBOL_NAME
NSE,E,100,EQUITY,0,ARE&M,1.0,Amara Raja,,,,5.0,NA,ES,EQ,AMARA RAJA
NSE,E,1000,EQUITY,0,656MH32,100.0,SDL MH 6.56%,,,,1.0,NA,DBT,SG,SDL MH
NSE,E,1,EQUITY,0,GOLDSTAR,11250.0,Goldstar Power,,,,5.0,NA,ES,SM,GOLDSTAR
BSE,C,1026077,FUTCUR,0,USDINR-FUT,1.0,USDINR FUT,,,,0.25,M,FUTCUR,,USDINR
"""
master = do.parse_scrip_master(MASTER_CSV)
assert master == {"ARE&M": "100"}, master
assert "656MH32" not in master, "an SDL bond is not a tradable cash equity here"
assert "GOLDSTAR" not in master, "SME series is not EQ"

# --- payloads ---------------------------------------------------------------------------------------
intent = {
    "client_id": "1000000009",
    "correlation_id": "SL2608301015001",
    "symbol": "ARE&M",
    "direction": "long",
    "quantity": 10,
    "limit_price": None,
    "product": "INTRADAY",
    "stop_price": 95.0,
    "target_price": 120.0,
    "reference_price": 100.0,
}

order = do.build_order(intent, "100")
assert order["transactionType"] == "BUY"
assert order["orderType"] == "MARKET" and order["price"] == 0, "a market order carries no price"
assert order["securityId"] == "100" and order["quantity"] == 10
assert order["exchangeSegment"] == "NSE_EQ" and order["validity"] == "DAY"

limit = do.build_order({**intent, "limit_price": 99.5}, "100")
assert limit["orderType"] == "LIMIT" and limit["price"] == 99.5

sup = do.build_super_order(intent, "100")
assert sup["targetPrice"] == 120.0 and sup["stopLossPrice"] == 95.0
assert "trailingJump" not in sup, "no trail asked for, no key sent"
assert do.build_super_order({**intent, "trailing_jump": 0.5}, "100")["trailingJump"] == 0.5

short = do.build_order({**intent, "direction": "short"}, "100")
assert short["transactionType"] == "SELL"

# Only the legal fields per leg - Dhan rejects the rest, and finding that out from a 400 while a
# position is open is the wrong time.
entry = do.modify_payload("C1", "42", "ENTRY_LEG", price=101.0, quantity=5)
assert entry["legName"] == "ENTRY_LEG" and entry["price"] == 101.0 and entry["quantity"] == 5
target = do.modify_payload("C1", "42", "TARGET_LEG", targetPrice=130.0, price=None)
assert target == {"dhanClientId": "C1", "orderId": "42", "legName": "TARGET_LEG", "targetPrice": 130.0}
for bad in (
    lambda: do.modify_payload("C1", "42", "TARGET_LEG", price=101.0),
    lambda: do.modify_payload("C1", "42", "STOP_LOSS_LEG", quantity=5),
    lambda: do.modify_payload("C1", "42", "NONSENSE_LEG", price=1.0),
):
    try:
        bad()
        raise AssertionError("should have refused an illegal leg modification")
    except ValueError:
        pass

# Closing reads the direction off the position, never off the caller.
flat = do.exit_intent({"net_qty": 10, "product": "INTRADAY"}, "C", "client")
assert flat["direction"] == "short" and flat["quantity"] == 10
assert do.exit_intent({"net_qty": -4}, "C", "client")["direction"] == "long"

assert len(do.correlation_id("SL", datetime(2026, 8, 30, 10, 15, 0), "1")) <= 30

# --- guardrails --------------------------------------------------------------------------------------
LIMITS = {"enabled": True, "max_order_value": 25000, "max_orders_per_day": 20, "daily_loss_limit": 5000}
CLEAR = {"halted": False, "orders_today": 0, "realised_today": 0}

assert do.guardrail_errors(intent, LIMITS, CLEAR) == [], do.guardrail_errors(intent, LIMITS, CLEAR)

off = do.guardrail_errors(intent, {**LIMITS, "enabled": False}, CLEAR)
assert any("switched off" in e for e in off), off

halted = do.guardrail_errors(intent, LIMITS, {**CLEAR, "halted": True, "halt_reason": "kill switch"})
assert any("halted" in e for e in halted), halted

big = do.guardrail_errors({**intent, "quantity": 400}, LIMITS, CLEAR)  # 400 x 100 = 40,000
assert any("per-order cap" in e for e in big), big

many = do.guardrail_errors(intent, LIMITS, {**CLEAR, "orders_today": 20})
assert any("cap is 20" in e for e in many), many

# The loss limit trips at exactly the limit, not one rupee past it.
assert any("past the" in e for e in do.guardrail_errors(intent, LIMITS, {**CLEAR, "realised_today": -5000}))
assert do.guardrail_errors(intent, LIMITS, {**CLEAR, "realised_today": -4999.99}) == []

wrong_stop = do.guardrail_errors({**intent, "stop_price": 105.0}, LIMITS, CLEAR)
assert any("Stop-loss must be below entry" in e for e in wrong_stop), wrong_stop
wrong_target = do.guardrail_errors({**intent, "target_price": 90.0}, LIMITS, CLEAR)
assert any("Target must be above entry" in e for e in wrong_target), wrong_target
# ... and the same levels are correct for a sell, which is why the check reads the direction.
assert do.guardrail_errors(
    {**intent, "direction": "short", "stop_price": 105.0, "target_price": 90.0}, LIMITS, CLEAR
) == []

assert any("whole number" in e for e in do.guardrail_errors({**intent, "quantity": 1.5}, LIMITS, CLEAR))
assert any("above 0" in e for e in do.guardrail_errors({**intent, "quantity": 0}, LIMITS, CLEAR))
assert any("No price to size" in e for e in do.guardrail_errors(
    {**intent, "reference_price": None, "limit_price": None}, LIMITS, CLEAR))

# --- reading the broker back ---------------------------------------------------------------------------
raw_order = {
    "orderId": "112111182198", "correlationId": "SL260830101500", "orderStatus": "TRADED",
    "tradingSymbol": "ARE&M", "securityId": "100", "transactionType": "BUY",
    "productType": "INTRADAY", "orderType": "MARKET", "quantity": 10, "filledQty": 10,
    "averageTradedPrice": 100.5, "updateTime": "2026-08-30 10:15:04",
}
norm = do.normalize_order(raw_order)
assert norm["order_id"] == "112111182198" and norm["status"] == "TRADED" and norm["avg_price"] == 100.5

# Dhan puts a message in omsErrorDescription on the way through, not only when something broke.
assert do.normalize_order({**raw_order, "omsErrorDescription": "TRADE CONFIRMED"})["error"] is None
assert do.normalize_order(
    {**raw_order, "orderStatus": "REJECTED", "omsErrorDescription": "insufficient funds"}
)["error"] == "insufficient funds"

# A super order's legs carry the SAME orderId as the entry, so flattening has to key them apart or
# the stop lands on the entry's row: one row, half entry and half stop, and no stop anywhere.
_send = do.send
do.send = lambda *a, **k: [{
    **raw_order, "orderId": "9", "legName": "ENTRY_LEG", "orderStatus": "TRADED",
    "legDetails": [{"orderId": "9", "legName": "STOP_LOSS_LEG", "orderStatus": "PENDING",
                    "transactionType": "SELL", "price": 95.0, "remainingQuantity": 10}],
}]
flat = do.super_order_book({})
assert [o["order_id"] for o in flat] == ["9", "9:STOP_LOSS_LEG"], flat
entry, stop = flat
assert (entry["leg"], entry["side"], entry["status"]) == ("ENTRY_LEG", "BUY", "TRADED")
assert (stop["leg"], stop["side"], stop["status"]) == ("STOP_LOSS_LEG", "SELL", "PENDING")
assert stop["parent_order_id"] == "9", "cancelling a leg sends the broker's id, not the row key"
# The entry filled at 100.5; the resting stop has filled nothing and is not the entry's fill.
assert stop["filled_qty"] == 0 and stop["avg_price"] is None, stop
do.send = _send

before = {"1": {"order_id": "1", "status": "PENDING"}}
now = [
    {"order_id": "1", "status": "TRADED"},      # moved
    {"order_id": "2", "status": "PENDING"},     # new, still working
    {"order_id": "3", "status": "TRADED"},      # filled while the app was asleep
]
changed = {o["order_id"]: was for o, was in do.status_changes(before, now)}
assert changed == {"1": "PENDING", "2": None, "3": None}, changed
assert do.status_changes({"1": {"order_id": "1", "status": "TRADED"}},
                         [{"order_id": "1", "status": "TRADED"}]) == [], "no change, no alert"

# A position that went to zero AND one that vanished from the book both count as closed - Dhan
# drops settled intraday positions rather than reporting them at zero.
prev = {
    "100": {"security_id": "100", "symbol": "ARE&M", "net_qty": 10, "buy_qty": 10, "sell_qty": 0,
            "buy_avg": 100.0, "sell_avg": None, "position_type": "LONG"},
    "200": {"security_id": "200", "symbol": "TCS", "net_qty": -5, "buy_qty": 0, "sell_qty": 5,
            "buy_avg": None, "sell_avg": 3000.0, "position_type": "SHORT"},
    "300": {"security_id": "300", "symbol": "INFY", "net_qty": 0},  # already flat last sweep
}
current = [
    {"security_id": "100", "symbol": "ARE&M", "net_qty": 0, "buy_qty": 10, "sell_qty": 10,
     "buy_avg": 100.0, "sell_avg": 104.0, "position_type": "LONG", "realised": 40.0},
]
closed = {p["security_id"]: p for p in do.closed_positions(prev, current)}
assert set(closed) == {"100", "200"}, closed
assert closed["100"]["sell_avg"] == 104.0, "the closing sweep's numbers win"

long_trade = do.journal_trade(closed["100"])
assert long_trade == {"symbol": "ARE&M", "direction": "long", "quantity": 10,
                      "entry_price": 100.0, "exit_price": 104.0}, long_trade

short_trade = do.journal_trade({"symbol": "TCS", "position_type": "SHORT", "buy_qty": 5,
                                "sell_qty": 5, "buy_avg": 2980.0, "sell_avg": 3000.0})
assert short_trade["direction"] == "short"
assert short_trade["entry_price"] == 3000.0 and short_trade["exit_price"] == 2980.0, \
    "a short is entered at the sell and exited at the buy"

# Half a round trip is not a journal entry, and a missing price must never become a zero.
assert do.journal_trade(closed["200"]) is None, "no buy price yet - nothing to file"
assert do.journal_trade({"buy_qty": 0, "sell_qty": 0}) is None

# --- alerts ----------------------------------------------------------------------------------------
above = {"kind": "price", "active": True, "condition": "above", "price": 100.0, "symbol": "TCS"}
below = {**above, "condition": "below"}
assert alerts.should_fire(above, 100.0), "at the level counts - 'tell me at 100' means 100"
assert alerts.should_fire(above, 101.0) and not alerts.should_fire(above, 99.9)
assert alerts.should_fire(below, 99.0) and not alerts.should_fire(below, 100.01)
assert not alerts.should_fire({**above, "active": False}, 200.0), "a disarmed alert stays quiet"
assert not alerts.should_fire({**above, "kind": "order"}, 200.0), "order events aren't conditions"
assert not alerts.should_fire(above, None), "no quote is not a trigger"
assert "TCS" in alerts.message_for(above, 101.0) and "101" in alerts.message_for(above, 101.0)

print("ok - live trading: scrip filter, payloads, leg rules, guardrails, mirror reads, journaling, alerts")

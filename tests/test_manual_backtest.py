"""Self-check for the manual-backtesting additions: setup/ideal-risk on trades, settings,
and balance adjustments. See docs/manual-backtesting-improvement-plan.md."""
import sys
from pathlib import Path

# Run as a script, so the repo root has to go on sys.path before importing app.* - the package
# is not installed, it just sits at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import db

SYMBOL = "ZZZMANUALTEST"


def test_manual_trade_roundtrips_setup_and_ideal_risk():
    db.init_schema()
    trade_id = db.create_manual_trade(
        SYMBOL, "long", 10, 100.0, 110.0, 95.0, 120.0, False, "profit", "Confident", ["test"],
        "note", None, setup="Breakout", ideal_risk_amount=500.0,
    )
    try:
        trade = db.get_manual_trade(trade_id)
        assert trade["setup"] == "Breakout"
        assert trade["ideal_risk_amount"] == 500.0

        db.update_manual_trade(
            trade_id, SYMBOL, "long", 10, 100.0, 110.0, 95.0, 120.0, False, "profit", "Confident",
            ["test"], "note", None, setup="Mean Reversion", ideal_risk_amount=250.0,
        )
        trade = db.get_manual_trade(trade_id)
        assert trade["setup"] == "Mean Reversion"
        assert trade["ideal_risk_amount"] == 250.0
    finally:
        db.delete_manual_trade(trade_id)
    assert db.get_manual_trade(trade_id) is None


def test_manual_backtest_settings_roundtrip():
    original = db.get_manual_backtest_settings()
    try:
        db.set_manual_backtest_settings(
            {"setups": ["Breakout", "Reversal"], "risk_deviation_tolerance_pct": 15, "opening_balance": 100000}
        )
        settings = db.get_manual_backtest_settings()
        assert settings["setups"] == ["Breakout", "Reversal"]
        assert settings["risk_deviation_tolerance_pct"] == 15
        assert settings["opening_balance"] == 100000
    finally:
        db.set_manual_backtest_settings(original)


def test_balance_adjustment_roundtrip():
    adj_id = db.create_balance_adjustment(5000, "add", "Deposit", "test note", None)
    try:
        rows = db.list_balance_adjustments()
        assert any(r["id"] == adj_id and r["amount"] == 5000 and r["type"] == "add" for r in rows)
    finally:
        db.delete_balance_adjustment(adj_id)
    assert not any(r["id"] == adj_id for r in db.list_balance_adjustments())


def test_review_fields_survive_a_put_that_omits_them():
    """The review is written only when a PUT actually sends it: bulk edit resends the row without
    the review keys, and that must not wipe a review it never knew about. Scratch DB only - this
    goes through the router, and the router doesn't know what a test row is."""
    if "scratch" not in db.DATABASE_URL:
        print("skipped review check: point DATABASE_URL at a scratch database to run it")
        return
    from app.routers import manual_trades as router
    from app.schemas import ManualTradeRequest, TradeReviewRequest

    db.init_schema()
    base = dict(symbol=SYMBOL, direction="long", quantity=10, entry_price=100.0, exit_price=95.0,
                stop_loss=97.0, result="loss")
    checks = {"entry_rules": True, "position_size": True, "stop_honored": False,
              "exit_rules": True, "no_impulse": True, "followed_plan": False}
    trade_id = router.create_manual_trade(ManualTradeRequest(
        **base, mistakes=["Stop"], execution_checks=checks, execution_score=7,
        pre_trade_checks={"entry_rules": True},
    ))["id"]
    try:
        t = db.get_manual_trade(trade_id)
        assert t["mistakes"] == ["Stop"] and t["execution_score"] == 7
        assert t["execution_checks"] == checks and t["pre_trade_checks"] == {"entry_rules": True}

        router.update_manual_trade(trade_id, ManualTradeRequest(**base, setup="Breakout"))
        t = db.get_manual_trade(trade_id)
        assert t["setup"] == "Breakout", t["setup"]
        assert t["mistakes"] == ["Stop"] and t["execution_score"] == 7, "omitted review was wiped"

        router.update_manual_trade(trade_id, ManualTradeRequest(**base, mistakes=[], execution_score=None))
        t = db.get_manual_trade(trade_id)
        assert t["mistakes"] == [] and t["execution_score"] is None, "explicit clear ignored"
        assert t["execution_checks"] == checks, "an unsent field was touched"

        db.update_manual_trade_image(trade_id, "entry.png", entry=True)
        t = db.get_manual_trade(trade_id)
        assert t["image_filename_entry"] == "entry.png" and t["image_filename"] is None
    finally:
        db.delete_manual_trade(trade_id)
    assert db.get_manual_trade(trade_id) is None

    review_id = router.create_trade_review(TradeReviewRequest(
        period_start="2026-09-14", period_end="2026-09-20", keep="  ", change="No trades before 9:45",
        change_from="2026-09-21",
    ))["id"]
    try:
        r = next(r for r in db.list_trade_reviews() if r["id"] == review_id)
        assert r["keep"] is None and r["change"] == "No trades before 9:45"
        assert str(r["change_from"]) == "2026-09-21"
    finally:
        db.delete_trade_review(review_id)
    assert not any(r["id"] == review_id for r in db.list_trade_reviews())


if __name__ == "__main__":
    test_manual_trade_roundtrips_setup_and_ideal_risk()
    test_manual_backtest_settings_roundtrip()
    test_balance_adjustment_roundtrip()
    test_review_fields_survive_a_put_that_omits_them()
    print("all checks passed")

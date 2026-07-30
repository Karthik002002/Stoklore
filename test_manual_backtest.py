"""Self-check for the manual-backtesting additions: setup/ideal-risk on trades, settings,
and balance adjustments. See docs/manual-backtesting-improvement-plan.md."""
import db

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


if __name__ == "__main__":
    test_manual_trade_roundtrips_setup_and_ideal_risk()
    test_manual_backtest_settings_roundtrip()
    test_balance_adjustment_roundtrip()
    print("all checks passed")

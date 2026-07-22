"""Evaluates user-defined watch rules against live data - bridges "here's an event" and "should I
act" without the app giving investment advice: the user sets the bar, this just checks whether
it's currently met."""
from datetime import date, timedelta

import db
import prices
import scraper


def evaluate(rule, symbol):
    """Returns {passed, checks: [{label, passed, detail}]} - one entry per criterion the rule
    actually set (unset/None fields are skipped). passed is True only if every set criterion
    passed (and at least one criterion was set). Rules aren't tied to a stock - symbol is chosen
    at check time, so the same rule can be checked against any watchlisted stock."""
    checks = []

    if rule.get("max_pe") is not None:
        pe = scraper.get_quote(symbol).get("trailingPE")
        passed = pe is not None and pe <= rule["max_pe"]
        checks.append({
            "label": f"P/E under {rule['max_pe']:g}",
            "passed": passed,
            "detail": f"current P/E: {pe:.2f}" if pe is not None else "P/E unavailable",
        })

    if rule.get("ema_short") and rule.get("ema_long"):
        signal = prices.ema_crossover(symbol, rule["ema_short"], rule["ema_long"])
        bullish = signal is not None and signal["shortEma"] > signal["longEma"]
        checks.append({
            "label": f"EMA{rule['ema_short']} above EMA{rule['ema_long']}",
            "passed": bullish,
            "detail": (f"EMA{rule['ema_short']}: {signal['shortEma']:.2f} vs "
                       f"EMA{rule['ema_long']}: {signal['longEma']:.2f}") if signal
            else "not enough synced price history - run a price sync first",
        })

    if rule.get("no_negative_events_days") is not None:
        since = (date.today() - timedelta(days=rule["no_negative_events_days"])).isoformat()
        negative = [e for e in db.list_events(symbol=symbol, from_date=since)
                    if e["sentiment_label"] == "negative"]
        checks.append({
            "label": f"No negative-sentiment events in the last {rule['no_negative_events_days']} days",
            "passed": len(negative) == 0,
            "detail": f"{len(negative)} negative event(s) found" if negative else "none found",
        })

    return {"passed": bool(checks) and all(c["passed"] for c in checks), "checks": checks}

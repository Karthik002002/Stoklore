"""Self-check for rules.evaluate and llm.parse_watch_rule - mocks scraper/prices/db/the LLM call
so it runs without live network, DB, or a configured model."""
from unittest.mock import patch

import llm
import rules


def test_max_pe_check():
    rule = {"max_pe": 25}
    with patch("scraper.get_quote", return_value={"trailingPE": 20}):
        result = rules.evaluate(rule, "TEST")
    assert result["passed"] is True
    assert result["checks"][0]["passed"] is True

    with patch("scraper.get_quote", return_value={"trailingPE": 30}):
        result = rules.evaluate(rule, "TEST")
    assert result["passed"] is False


def test_ema_bullish_check():
    rule = {"ema_short": 20, "ema_long": 50}
    with patch("prices.ema_crossover", return_value={"shortEma": 110, "longEma": 100, "crossover": None}):
        result = rules.evaluate(rule, "TEST")
    assert result["passed"] is True

    with patch("prices.ema_crossover", return_value={"shortEma": 90, "longEma": 100, "crossover": None}):
        result = rules.evaluate(rule, "TEST")
    assert result["passed"] is False

    with patch("prices.ema_crossover", return_value=None):
        result = rules.evaluate(rule, "TEST")
    assert result["passed"] is False  # not enough history counts as not-passed, not skipped


def test_no_negative_events_check():
    rule = {"no_negative_events_days": 14}
    with patch("db.list_events", return_value=[]):
        result = rules.evaluate(rule, "TEST")
    assert result["passed"] is True

    with patch("db.list_events", return_value=[{"sentiment_label": "negative"}, {"sentiment_label": "positive"}]):
        result = rules.evaluate(rule, "TEST")
    assert result["passed"] is False
    assert "1 negative" in result["checks"][0]["detail"]


def test_no_criteria_set_never_passes():
    assert rules.evaluate({}, "TEST")["passed"] is False


def test_multiple_criteria_all_must_pass():
    rule = {"max_pe": 25, "no_negative_events_days": 14}
    with patch("scraper.get_quote", return_value={"trailingPE": 20}), \
         patch("db.list_events", return_value=[{"sentiment_label": "negative"}]):
        result = rules.evaluate(rule, "TEST")
    assert result["passed"] is False  # PE ok, but a negative event fails the combined rule
    assert len(result["checks"]) == 2


def test_same_rule_checks_different_symbols_independently():
    rule = {"max_pe": 25}
    with patch("scraper.get_quote", side_effect=lambda s: {"trailingPE": 20 if s == "GOOD" else 30}):
        assert rules.evaluate(rule, "GOOD")["passed"] is True
        assert rules.evaluate(rule, "BAD")["passed"] is False


def test_parse_watch_rule_extracts_only_mentioned_fields():
    reply = '{"max_pe": 25, "ema_short": 20, "ema_long": 50, "no_negative_events_days": 14}'
    with patch("llm._generate", return_value=reply):
        parsed = llm.parse_watch_rule("P/E under 25 AND EMA20 above EMA50 AND no negative events in 14d")
    assert parsed == {"max_pe": 25, "ema_short": 20, "ema_long": 50, "no_negative_events_days": 14}

    # model wraps the JSON in prose, and only mentions one criterion - null fields dropped
    with patch("llm._generate", return_value='Sure, here it is: {"max_pe": 30, "ema_short": null}\nhope that helps'):
        parsed = llm.parse_watch_rule("P/E under 30")
    assert parsed == {"max_pe": 30}

    with patch("llm._generate", return_value="I don't understand this request"):
        assert llm.parse_watch_rule("blah blah") == {}


if __name__ == "__main__":
    test_max_pe_check()
    test_ema_bullish_check()
    test_no_negative_events_check()
    test_no_criteria_set_never_passes()
    test_multiple_criteria_all_must_pass()
    test_same_rule_checks_different_symbols_independently()
    test_parse_watch_rule_extracts_only_mentioned_fields()
    print("all checks passed")

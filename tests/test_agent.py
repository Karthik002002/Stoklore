"""Self-check for the Ollama tool-calling agent loop: tool round-trip, errors, runaway cap."""
import sys
from pathlib import Path

# Run as a script, so the repo root has to go on sys.path before importing app.* - the package
# is not installed, it just sits at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import date, timedelta

from app.core import llm
from app.services import agent

TOOLS = [{"type": "function", "function": {"name": "get_price", "parameters": {}}}]


def test_agent_executes_tool_then_answers():
    responses = [
        {"message": {"role": "assistant", "content": "", "tool_calls": [
            {"function": {"name": "get_price", "arguments": {"symbol": "TCS"}}}]}},
        {"message": {"role": "assistant", "content": "TCS trades at ₹2,251."}},
    ]
    seen_bodies = []

    def fake_post(path, body):
        seen_bodies.append(body)
        return responses[len(seen_bodies) - 1]

    llm._ollama_post = fake_post
    impls = {"get_price": lambda symbol: {"price": 2251.1}}
    reply = llm.run_agent([{"role": "user", "content": "price of TCS?"}], TOOLS, impls, "ollama/hf.co/empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF:Q4_K_M")

    assert reply == "TCS trades at ₹2,251."
    assert seen_bodies[0]["model"] == "hf.co/empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF:Q4_K_M"          # ollama/ prefix stripped
    assert seen_bodies[0]["tools"] == TOOLS
    tool_msgs = [m for m in seen_bodies[1]["messages"] if m["role"] == "tool"]
    assert tool_msgs and "2251.1" in tool_msgs[0]["content"]  # tool result fed back to the model


def test_agent_survives_tool_errors_and_caps_rounds():
    def always_call_tool(path, body):
        return {"message": {"role": "assistant", "content": "", "tool_calls": [
            {"function": {"name": "explode", "arguments": {}}}]}}

    llm._ollama_post = always_call_tool
    impls = {"explode": lambda: (_ for _ in ()).throw(ValueError("boom"))}
    reply = llm.run_agent([{"role": "user", "content": "hi"}], TOOLS, impls, "ollama/hf.co/empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF:Q4_K_M", max_rounds=2)
    assert "tool-call limit" in reply  # capped, error surfaced as text instead of crashing


def test_agent_works_with_litellm_openai_shaped_tool_calls():
    """LiteLLM/OmniRoute are OpenAI-compatible: arguments arrive as a JSON *string* (not an
    object like Ollama's), and tool results must echo back a matching tool_call_id."""
    llm.configure_litellm("http://localhost:4000", api_key="sk-test")
    responses = [
        {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [
            {"id": "call_abc", "function": {"name": "get_price", "arguments": '{"symbol": "TCS"}'}}]}}]},
        {"choices": [{"message": {"role": "assistant", "content": "TCS trades at ₹2,251."}}]},
    ]
    seen = []

    def fake_post(base, path, body, headers=None, timeout=120):
        assert base == "http://localhost:4000"
        assert headers == {"Authorization": "Bearer sk-test"}
        seen.append(body)
        return responses[len(seen) - 1]

    llm._post = fake_post
    impls = {"get_price": lambda symbol: {"price": 2251.1}}
    reply = llm.run_agent([{"role": "user", "content": "price of TCS?"}], TOOLS, impls, "litellm/gpt-4o-mini")

    assert reply == "TCS trades at ₹2,251."
    assert seen[0]["model"] == "gpt-4o-mini"  # litellm/ prefix stripped
    tool_msgs = [m for m in seen[1]["messages"] if m["role"] == "tool"]
    assert tool_msgs[0]["tool_call_id"] == "call_abc"  # OpenAI-style results need the id echoed back
    assert "2251.1" in tool_msgs[0]["content"]
    llm.configure_litellm(None)  # reset module-level config for other tests


# --- get_ema_crossover: usable by a run with nobody watching ----------------------------------------
# It used to answer "run a price sync first", which a 06:15 workflow cannot act on - so a fan-out
# over a watchlist came back as that sentence for every symbol that had never been synced.


def _stub_prices(latest, signal):
    """Stands in for the database and the sync, so these need neither. Returns the list the fake
    sync appends to; `signal` is what the EMA reads once a sync has happened."""
    synced = []
    agent.db.latest_price_date = lambda symbol: latest
    agent.prices.sync_symbol = lambda symbol: synced.append(symbol)
    agent.prices.ema_crossover = lambda symbol, short, long: signal if synced else None
    return synced


def test_ema_crossover_syncs_a_symbol_with_no_history():
    synced = _stub_prices(None, {"crossover": "bullish", "shortEma": 1.0, "longEma": 0.9})
    result = agent._tool_ema_crossover("wabag")

    assert synced == ["WABAG"], "a symbol with no stored history is synced, not refused"
    assert result == {"symbol": "WABAG", "crossover": "bullish", "shortEma": 1.0, "longEma": 0.9}


def test_ema_crossover_refreshes_only_stale_history():
    stale = date.today() - timedelta(days=agent.EMA_STALE_DAYS + 1)
    synced = _stub_prices(stale, {"crossover": None})
    agent._tool_ema_crossover("COFORGE")
    assert synced == ["COFORGE"], "history older than the staleness window is refetched"

    synced = _stub_prices(date.today(), {"crossover": None})
    agent._tool_ema_crossover("COFORGE")
    assert synced == [], "today's history is not refetched on every run"


def test_ema_crossover_always_answers_with_the_symbol():
    _stub_prices(None, None)  # the sync runs, but there still aren't enough bars
    result = agent._tool_ema_crossover("FSL", short=20, long=50)

    assert result["symbol"] == "FSL" and result["crossover"] is None
    assert "52 daily bars" in result["error"], "says what is missing, as data rather than prose"


if __name__ == "__main__":
    test_agent_executes_tool_then_answers()
    test_agent_survives_tool_errors_and_caps_rounds()
    test_agent_works_with_litellm_openai_shaped_tool_calls()
    test_ema_crossover_syncs_a_symbol_with_no_history()
    test_ema_crossover_refreshes_only_stale_history()
    test_ema_crossover_always_answers_with_the_symbol()
    print("all checks passed")


"""Self-check for the Ollama tool-calling agent loop: tool round-trip, errors, runaway cap."""
import llm

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
    reply = llm.run_agent([{"role": "user", "content": "price of TCS?"}], TOOLS, impls, "ollama/llama3.1")

    assert reply == "TCS trades at ₹2,251."
    assert seen_bodies[0]["model"] == "llama3.1"          # ollama/ prefix stripped
    assert seen_bodies[0]["tools"] == TOOLS
    tool_msgs = [m for m in seen_bodies[1]["messages"] if m["role"] == "tool"]
    assert tool_msgs and "2251.1" in tool_msgs[0]["content"]  # tool result fed back to the model


def test_agent_survives_tool_errors_and_caps_rounds():
    def always_call_tool(path, body):
        return {"message": {"role": "assistant", "content": "", "tool_calls": [
            {"function": {"name": "explode", "arguments": {}}}]}}

    llm._ollama_post = always_call_tool
    impls = {"explode": lambda: (_ for _ in ()).throw(ValueError("boom"))}
    reply = llm.run_agent([{"role": "user", "content": "hi"}], TOOLS, impls, "ollama/llama3.1", max_rounds=2)
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


if __name__ == "__main__":
    test_agent_executes_tool_then_answers()
    test_agent_survives_tool_errors_and_caps_rounds()
    test_agent_works_with_litellm_openai_shaped_tool_calls()
    print("all checks passed")

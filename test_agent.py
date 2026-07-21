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


if __name__ == "__main__":
    test_agent_executes_tool_then_answers()
    test_agent_survives_tool_errors_and_caps_rounds()
    print("all checks passed")

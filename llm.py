"""Talks to a local Ollama server (default) or OmniRoute (multi-provider) for chat/generation.
Embeddings always stay on local Ollama - see embed() for why.
"""
import json
import urllib.error
import urllib.request

OLLAMA_BASE = "http://localhost:11434"
OMNIROUTE_BASE = "http://localhost:20128/v1"
EMBED_MODEL = "nomic-embed-text"
DEFAULT_MODEL = "ollama/llama3.1"


def _post(base, path, body, timeout=120):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{base}{path}", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def embed(text):
    """Always local Ollama - scraped_items.embedding is a fixed VECTOR(768) column, so the
    embedding model can't be swapped without breaking every existing row + similarity search."""
    return _post(OLLAMA_BASE, "/api/embed", {"model": EMBED_MODEL, "input": text})["embeddings"][0]


def _ollama_post(path, body):
    try:
        return _post(OLLAMA_BASE, path, body)
    except (urllib.error.URLError, ConnectionRefusedError) as e:
        raise RuntimeError("Ollama is unavailable - is `ollama serve` running?") from e


def _omniroute_chat(messages, model):
    try:
        resp = _post(OMNIROUTE_BASE, "/chat/completions", {"model": model, "messages": messages, "stream": False})
    except urllib.error.HTTPError as e:
        # OmniRoute is up but the upstream call failed (e.g. free-tier pool exhausted) - surface its message
        try:
            detail = json.load(e)["error"]["message"]
        except Exception:
            detail = f"HTTP {e.code}"
        raise RuntimeError(f"'{model}' request failed via OmniRoute: {detail}") from e
    except (urllib.error.URLError, ConnectionRefusedError) as e:
        raise RuntimeError(f"'{model}' is unavailable - is `omniroute serve` running?") from e
    return resp["choices"][0]["message"]["content"].strip()


def _generate(prompt, model):
    """Single-prompt completion, routed to Ollama's /api/generate or OmniRoute's chat/completions."""
    if model.startswith("ollama/"):
        ollama_model = model.removeprefix("ollama/")
        return _ollama_post("/api/generate", {"model": ollama_model, "prompt": prompt, "stream": False})[
            "response"
        ].strip()
    return _omniroute_chat([{"role": "user", "content": prompt}], model)


def _chat(messages, model):
    """Multi-turn chat, routed to Ollama's /api/chat or OmniRoute's chat/completions."""
    if model.startswith("ollama/"):
        ollama_model = model.removeprefix("ollama/")
        return _ollama_post("/api/chat", {"model": ollama_model, "messages": messages, "stream": False})[
            "message"
        ]["content"].strip()
    return _omniroute_chat(messages, model)


def run_agent_stream(messages, tools, tool_impls, model, max_rounds=5):
    """Native Ollama tool-calling agent loop - no LangChain. `tools` is the JSON-schema list
    Ollama's /api/chat accepts; `tool_impls` maps tool name -> python callable. The model is
    called repeatedly: each round either returns plain text (done) or tool_calls, which are
    executed and fed back as role:"tool" messages. Ollama-only - callers route non-ollama
    models elsewhere. max_rounds caps runaway loops; the 8B model rarely needs more than 2.

    Generator, so callers can surface tool activity live in the UI. Yields, in order:
      ("tool", call_id, name, args)     - before a tool executes
      ("tool_result", call_id, result)  - after it finishes
      ("done", final_text)              - always the last event
    """
    ollama_model = model.removeprefix("ollama/")
    msgs = list(messages)
    msg = {}
    call_seq = 0
    for _ in range(max_rounds):
        msg = _ollama_post(
            "/api/chat", {"model": ollama_model, "messages": msgs, "tools": tools, "stream": False}
        )["message"]
        calls = msg.get("tool_calls")
        if not calls:
            yield ("done", msg["content"].strip())
            return
        msgs.append(msg)
        for call in calls:
            name = call["function"]["name"]
            args = call["function"].get("arguments") or {}
            call_seq += 1
            call_id = f"call_{call_seq}"
            yield ("tool", call_id, name, args)
            try:
                result = tool_impls[name](**args)
            except KeyError:
                result = f"unknown tool '{name}'"
            except Exception as e:
                result = f"tool '{name}' failed: {e}"
            yield ("tool_result", call_id, result)
            msgs.append({"role": "tool", "content": json.dumps(result, default=str)})
    yield ("done", (msg.get("content") or "").strip()
           or "I couldn't finish that within the tool-call limit - try a more specific request.")


def run_agent(messages, tools, tool_impls, model, max_rounds=5):
    """Non-streaming wrapper: drains run_agent_stream and returns just the final text."""
    for event in run_agent_stream(messages, tools, tool_impls, model, max_rounds):
        if event[0] == "done":
            return event[1]


def get_models():
    """Live OmniRoute catalog plus the always-available local Ollama model. Degrades to just
    Ollama if OmniRoute isn't running, rather than erroring."""
    models = [{"id": DEFAULT_MODEL, "label": "Llama 3.1 (local)"}]
    try:
        req = urllib.request.Request(f"{OMNIROUTE_BASE}/models")
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.load(r)
        models += [{"id": m["id"], "label": m["id"]} for m in data.get("data", [])]
    except (urllib.error.URLError, ConnectionRefusedError):
        pass
    return models


def build_markdown(symbol, financials, news, model=DEFAULT_MODEL):
    """Asks the LLM to return a full Markdown report, stored and rendered verbatim."""
    headlines = "\n".join(f"- {n['title']}: {n['summary']}" for n in news) or "No recent news."
    prompt = (
        f"Stock {symbol}. Financials: {financials}.\n"
        f"Recent news:\n{headlines}\n\n"
        "Write a short Markdown report for this stock: a '## SYMBOL' heading, "
        "a bullet list of the key financial stats given, a bullet list of the news "
        "headlines, and a 2-3 sentence factual take on why it's moving. This is an NSE "
        "India stock - use ₹ for any currency figures, never $. No investment "
        "advice. Return only Markdown, no preamble."
    )
    return _generate(prompt, model)


def build_history_markdown(symbol, history, model=DEFAULT_MODEL):
    """Asks the LLM to summarize a scraped price-history window as a Markdown report."""
    prompt = (
        f"Stock {symbol}, price history from {history['start']} to {history['end']} "
        f"({history['tradingDays']} trading days).\n"
        f"Open: ₹{history['open']:.2f}, Close: ₹{history['close']:.2f}, "
        f"High: ₹{history['high']:.2f}, Low: ₹{history['low']:.2f}, "
        f"Change over period: {history['changePercent']:.2f}%, "
        f"Average daily volume: {history['avgVolume']:,}.\n\n"
        "Write a short Markdown report: a '## SYMBOL (start to end)' heading, a bullet "
        "list of the stats given, and a 2-3 sentence factual take on the price action over "
        "this window. This is an NSE India stock - use ₹ for currency, never $. No "
        "investment advice. Return only Markdown, no preamble."
    )
    return _generate(prompt, model)


def extract_tickers(text, model=DEFAULT_MODEL):
    """Asks the LLM which NSE-listed companies an article is about. Returns a list of ticker
    strings (may be empty) - reuses the existing chat model instead of a separate NER model."""
    prompt = (
        "Below is a news/blog article. List every company mentioned that is listed on India's "
        "NSE, as their NSE ticker symbols (e.g. TCS, INFY, RELIANCE). Skip companies that "
        "aren't NSE-listed or whose ticker you're unsure of. Reply with ONLY a JSON array of "
        'ticker strings, e.g. ["TCS", "INFY"]. If none, reply [].\n\n'
        f"Article:\n{text[:4000]}"
    )
    reply = _generate(prompt, model)
    try:
        tickers = json.loads(reply[reply.index("[") : reply.rindex("]") + 1])
        return [t.strip().upper() for t in tickers if isinstance(t, str) and t.strip()]
    except (ValueError, json.JSONDecodeError):
        return []


def explain_sentiment(text, label, model=DEFAULT_MODEL):
    """Asks the LLM to justify the FinRoBERTa sentiment label with specifics from the article -
    the classifier itself only outputs a label+score, no rationale."""
    prompt = (
        f"A financial sentiment classifier scored the article below as '{label}'. "
        "In 2-3 sentences, explain why, citing specific facts, numbers, or quotes from the "
        "article that support that label. Be concrete, not generic. Return only the explanation.\n\n"
        f"Article:\n{text[:4000]}"
    )
    return _generate(prompt, model)


NO_CONTEXT_REPLY = (
    "I don't have any stored or live-scraped report matching that. Mention an NSE "
    "ticker (e.g. TCS, INFY, RELIANCE) and I'll scrape it live, or run a scan first."
)


def chat(history, context, model=DEFAULT_MODEL):
    """history: list of {role, content}. context: retrieved Markdown snippets for RAG, or None if nothing matched."""
    if context is None:
        return NO_CONTEXT_REPLY
    system = (
        "You are a research assistant for NSE India stocks only. Answer using ONLY the "
        "retrieved reports below - never invent prices, tickers, or companies, and never "
        "mention US stocks (AAPL, AMZN, GOOGL, etc.) unless they literally appear in the "
        "reports. If the reports don't cover the question, say so plainly instead of "
        "guessing.\n\n" + context
    )
    messages = [{"role": "system", "content": system}] + history
    return _chat(messages, model)


def auto_title(first_message, model=DEFAULT_MODEL):
    prompt = f'Reply with only a 4-6 word title for a chat that starts with: "{first_message}"'
    return _generate(prompt, model).strip('"')

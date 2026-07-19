"""Talks to a local Ollama server for embeddings, report generation, and chat (stdlib only)."""
import json
import urllib.request

OLLAMA_BASE = "http://localhost:11434"
MODEL = "llama3.1"
EMBED_MODEL = "nomic-embed-text"


def _post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{OLLAMA_BASE}{path}", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def embed(text):
    return _post("/api/embed", {"model": EMBED_MODEL, "input": text})["embeddings"][0]


def build_markdown(symbol, financials, news):
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
    return _post("/api/generate", {"model": MODEL, "prompt": prompt, "stream": False})["response"].strip()


def build_history_markdown(symbol, history):
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
    return _post("/api/generate", {"model": MODEL, "prompt": prompt, "stream": False})["response"].strip()


NO_CONTEXT_REPLY = (
    "I don't have any stored or live-scraped report matching that. Mention an NSE "
    "ticker (e.g. TCS, INFY, RELIANCE) and I'll scrape it live, or run a scan first."
)


def chat(history, context):
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
    return _post("/api/chat", {"model": MODEL, "messages": messages, "stream": False})["message"]["content"].strip()


def auto_title(first_message):
    prompt = f'Reply with only a 4-6 word title for a chat that starts with: "{first_message}"'
    return _post("/api/generate", {"model": MODEL, "prompt": prompt, "stream": False})["response"].strip().strip('"')

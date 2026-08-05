from fastapi import APIRouter
import json
import re
import uuid

from fastapi.responses import StreamingResponse

import db
import llm
import rules
import scraper

from app.deps import _sse
from app.schemas import ChatRequest
from app.services.agent import (
    AGENT_SYSTEM,
    AGENT_TOOL_IMPLS,
    AGENT_TOOLS,
    CONFIRM_TOOLS,
    REAL_TOOL_IMPLS,
    _format_rule_check,
    _format_rule_check_all,
)
from app.services.scraping import _analyze_url, _embed_or_none, _live_scrape

router = APIRouter(tags=["chat"])

# ponytail: matches any all-caps 2-15 letter word as a candidate NSE symbol (NSE symbols are
# always uppercase). No validation against a real symbol list - relies on the live scrape
# coming back empty for junk input. Swap for a real symbol-list lookup if false positives bite.
TICKER_PATTERN = re.compile(r"\b[A-Z]{2,15}\b")

HISTORY_COMMAND = re.compile(
    r"^/history\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s*$", re.IGNORECASE
)
HISTORY_USAGE = "Usage: `/history SYMBOL YYYY-MM-DD YYYY-MM-DD` — e.g. `/history TCS 2026-01-01 2026-03-01`"

SENTIMENT_COMMAND = re.compile(r"^/sentiment\s+(\S+)\s*$", re.IGNORECASE)
SENTIMENT_USAGE = "Usage: `/sentiment URL` — e.g. `/sentiment https://example.com/some-news-article`"

RULE_COMMAND = re.compile(r"^/rule\s+(.+)$", re.IGNORECASE)
RULE_USAGE = ("Usage: `/rule RULE_NAME [SYMBOL]` — e.g. `/rule buy dip` checks it against your whole "
              "watchlist, `/rule buy dip MIDHANI` checks just MIDHANI (set up rules in Settings > Watch rules)")
def _text(message):
    return "".join(p.get("text", "") for p in message.get("parts", []) if p.get("type") == "text")


# Replayed tool output only needs to be recognizable to the model, not full-precision - a
# scrape_stock call returns a whole markdown report, and a few of those replayed on every later
# turn would blow past context limits fast. A fresh call within the same turn (llm.py's
# run_agent_stream) still gets the untruncated result; this cap is history-replay only.
_HISTORY_TOOL_OUTPUT_CHARS = 1500
# How many of the most recent messages get replayed to the model each turn - a sliding window so
# a long session's token cost stays bounded instead of growing every single turn.
MAX_HISTORY_MESSAGES = 20


def _history_text(message):
    """Renders one client message as plain text for the LLM's conversation history - text plus
    a rendering of any tool calls/results, not just the final reply. Without this, a completed
    tool call's actual data (e.g. web_search hits) vanishes from context on the next turn and
    the model re-runs the same tool instead of building on what it already found. Tool output is
    wrapped the same DATA-not-instructions way a live result is (llm._wrap_tool_result), so
    replayed results carry the same injection guard as a fresh call."""
    segments = []
    for p in message.get("parts", []):
        ptype = p.get("type", "")
        if ptype == "text" and p.get("text"):
            segments.append(p["text"])
        elif (ptype == "dynamic-tool" or ptype.startswith("tool-")) and p.get("state") == "output-available":
            name = p.get("toolName") or ptype.removeprefix("tool-")
            output = p.get("output")
            text = output if isinstance(output, str) else json.dumps(output, default=str, ensure_ascii=False)
            if len(text) > _HISTORY_TOOL_OUTPUT_CHARS:
                text = text[:_HISTORY_TOOL_OUTPUT_CHARS] + "…(truncated)"
            segments.append(llm._wrap_tool_result(name, text))
    return "\n\n".join(segments)


def _windowed_history(messages):
    """Last MAX_HISTORY_MESSAGES messages, rendered for the model - a sliding window so a long
    session doesn't send unbounded, ever-growing history on every turn."""
    return [{"role": m["role"], "content": _history_text(m)} for m in messages[-MAX_HISTORY_MESSAGES:]]
@router.get("/api/chat/sessions")
def sessions():
    return db.list_sessions()

@router.delete("/api/chat/sessions/{session_id}")
def delete_session(session_id: str):
    db.delete_session(session_id)
    return {"ok": True}



@router.get("/api/chat/sessions/{session_id}/messages")
def messages(session_id: str):
    return [
        {"id": str(uuid.uuid4()), "role": m["role"], "parts": [{"type": "text", "text": m["content"]}]}
        for m in db.list_messages(session_id)
    ]


@router.delete("/api/chat/sessions/{session_id}/messages")
def clear_session_messages(session_id: str):
    db.clear_messages(session_id)
    return {"ok": True}


def _history_reply(user_text, model):
    """Handles the /history SYMBOL FROM TO slash command. Returns a reply string, or None if not that command."""
    if not user_text.strip().lower().startswith("/history"):
        return None
    match = HISTORY_COMMAND.match(user_text.strip())
    if not match:
        return HISTORY_USAGE
    symbol, start, end = match.group(1).upper(), match.group(2), match.group(3)
    history = scraper.get_history(symbol, start, end)
    if history is None:
        return f"No price data found for '{symbol}' between {start} and {end}."
    markdown = llm.build_history_markdown(symbol, history, model=model)
    db.insert_scraped_item(symbol, markdown, _embed_or_none(markdown))
    return markdown




def _rule_reply(user_text):
    """Handles the /rule RULE_NAME [SYMBOL] slash command. A rule isn't tied to one stock: with no
    symbol it's checked against every watchlisted stock (a screener - which ones meet it right
    now); with a trailing symbol, just that one. Returns a reply string, or None if not that
    command."""
    if not user_text.strip().lower().startswith("/rule"):
        return None
    match = RULE_COMMAND.match(user_text.strip())
    if not match:
        return RULE_USAGE
    rest = match.group(1).strip()
    tokens = rest.split()
    symbol, name = None, rest
    if len(tokens) > 1 and tokens[-1].upper() in db.watchlist_symbols():
        symbol, name = tokens[-1].upper(), " ".join(tokens[:-1])
    rule = db.get_watch_rule(name)
    if rule is None:
        return f"No watch rule named '{name}' - set one up in Settings > Watch rules."
    if symbol:
        return _format_rule_check(rule["name"], symbol, rules.evaluate(rule, symbol))
    results = [{"symbol": s, **rules.evaluate(rule, s)} for s in db.watchlist_symbols()]
    return _format_rule_check_all(rule["name"], results)


def _sentiment_reply(user_text, model):
    """Handles the /sentiment URL slash command. Returns a reply string, or None if not that command."""
    if not user_text.strip().lower().startswith("/sentiment"):
        return None
    match = SENTIMENT_COMMAND.match(user_text.strip())
    if not match:
        return SENTIMENT_USAGE
    result = _analyze_url(match.group(1), model)
    if not result["tickers"]:
        tickers_line = "No NSE-listed tickers identified in this article."
    else:
        tickers_line = "\n".join(f"- **{t}**" for t in result["tickers"])
    return (
        f"**{result['title']}**\n\n"
        f"Sentiment: **{result['sentiment']['label']}** ({result['sentiment']['score']:.0%} confidence)\n\n"
        f"{result['reasoning']}\n\n"
        f"Related NSE stocks:\n{tickers_line}"
    )

CONFIRM_COMMAND = re.compile(r"^/confirm\s+(\w+)(?:\s+(.*))?$", re.IGNORECASE)
CONFIRM_USAGE = "Usage: `/confirm <tool> [args]` - e.g. `/confirm scan_events` or `/confirm scrape_stock symbol=TCS`"


def _parse_confirm(user_text):
    """Parses the /confirm <tool> [key=value ...] slash command - the human-in-the-loop gate for
    CONFIRM_TOOLS, sent either by the user typing it or by the UI's Confirm button. Returns
    (tool_name, kwargs) to run, or None if user_text isn't a /confirm command. Raises ValueError
    (usage/lookup errors) for a malformed or unknown command - caller turns that into a reply."""
    if not user_text.strip().lower().startswith("/confirm"):
        return None
    match = CONFIRM_COMMAND.match(user_text.strip())
    if not match:
        raise ValueError(CONFIRM_USAGE)
    name, arg_str = match.group(1), (match.group(2) or "").strip()
    if name not in CONFIRM_TOOLS:
        raise ValueError(f"'{name}' doesn't require confirmation (or isn't a tool) - nothing to do.")
    kwargs = {}
    for part in arg_str.split():
        if "=" in part:
            k, v = part.split("=", 1)
            kwargs[k] = v
    return name, kwargs
@router.post("/api/chat")
def post_chat(req: ChatRequest):
    is_new = len(req.messages) == 1
    db.ensure_session(req.sessionId)
    if req.model:
        db.set_session_model(req.sessionId, req.model)
    model = db.get_session_model(req.sessionId) or db.get_active_model()

    user_text = _text(req.messages[-1])

    use_agent = False
    reply = None
    try:
        confirm_call = _parse_confirm(user_text)
    except ValueError as e:
        confirm_call = None
        reply = str(e)
    try:
        if reply is None and confirm_call is None:
            reply = _rule_reply(user_text)
        if reply is None and confirm_call is None:
            reply = _sentiment_reply(user_text, model)
        if reply is None and confirm_call is None:
            reply = _history_reply(user_text, model)
        if reply is None and confirm_call is None and (model.startswith("ollama/") or model.startswith("litellm/")):
            # local llama or a LiteLLM-routed model: tool-calling agent. Deferred into stream()
            # below so each tool call can be pushed to the UI as it happens, instead of a long
            # silent wait. OmniRoute keeps the original RAG path below (tool support varies
            # across its many upstream providers).
            use_agent = True
        if reply is None and confirm_call is None and not use_agent:
            # OmniRoute models: original RAG path (tool schema support varies per provider)
            live_reports = list(filter(None, (
                _live_scrape(symbol, model) for symbol in dict.fromkeys(TICKER_PATTERN.findall(user_text))
            )))

            query_embedding = llm.embed(user_text)
            matches = db.similarity_search(query_embedding, limit=5)
            stored = [m["content_markdown"] for m in matches if m["content_markdown"] not in live_reports]
            context = "\n\n---\n\n".join(live_reports + stored) or None

            history = _windowed_history(req.messages)
            reply = llm.chat(history, context, model=model)
    except RuntimeError as e:
        # model-call failure (OmniRoute down / upstream exhausted) - show it in the chat, not a 500
        reply = f"⚠️ {e}"

    db.add_message(req.sessionId, "user", user_text)
    if not use_agent and confirm_call is None:
        db.add_message(req.sessionId, "assistant", reply)

    def stream():
        yield _sse({"type": "start", "messageId": str(uuid.uuid4())})

        final_reply = reply
        if confirm_call:
            name, kwargs = confirm_call
            call_id = str(uuid.uuid4())
            yield _sse({"type": "tool-input-available", "toolCallId": call_id,
                        "toolName": name, "input": kwargs})
            try:
                result = REAL_TOOL_IMPLS[name](**kwargs)
                final_reply = f"Ran `{name}`."
            except Exception as e:
                result = {"error": str(e)}
                final_reply = f"⚠️ `{name}` failed: {e}"
            yield _sse({"type": "tool-output-available", "toolCallId": call_id, "output": result})
            db.add_message(req.sessionId, "assistant", final_reply)
        if use_agent:
            history = _windowed_history(req.messages)
            messages = [{"role": "system", "content": AGENT_SYSTEM}] + history
            try:
                for event in llm.run_agent_stream(messages, AGENT_TOOLS, AGENT_TOOL_IMPLS, model):
                    if event[0] == "tool":
                        _, call_id, name, args = event
                        yield _sse({"type": "tool-input-available", "toolCallId": call_id,
                                    "toolName": name, "input": args})
                    elif event[0] == "tool_result":
                        _, call_id, result = event
                        yield _sse({"type": "tool-output-available", "toolCallId": call_id,
                                    "output": result})
                    else:
                        final_reply = event[1]
            except RuntimeError as e:
                final_reply = f"⚠️ {e}"
            db.add_message(req.sessionId, "assistant", final_reply)

        text_id = str(uuid.uuid4())
        yield _sse({"type": "text-start", "id": text_id})
        yield _sse({"type": "text-delta", "id": text_id, "delta": final_reply})
        yield _sse({"type": "text-end", "id": text_id})
        if is_new:
            try:
                title = llm.auto_title(user_text, model=model)
            except RuntimeError:
                title = user_text[:40]
            db.set_session_title(req.sessionId, title)
            yield _sse({"type": "data-title", "data": {"title": title}})
        yield _sse({"type": "finish"})
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"x-vercel-ai-ui-message-stream": "v1"}
    )

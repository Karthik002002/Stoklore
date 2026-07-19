"""FastAPI server: serves stored reports and a RAG chatbot (AI SDK UI Message Stream protocol) to React."""
import json
import re
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import db
import llm
import scraper

app = FastAPI()

# ponytail: matches any all-caps 2-15 letter word as a candidate NSE symbol (NSE symbols are
# always uppercase). No validation against a real symbol list - relies on the live scrape
# coming back empty for junk input. Swap for a real symbol-list lookup if false positives bite.
TICKER_PATTERN = re.compile(r"\b[A-Z]{2,15}\b")

HISTORY_COMMAND = re.compile(
    r"^/history\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s*$", re.IGNORECASE
)
HISTORY_USAGE = "Usage: `/history SYMBOL YYYY-MM-DD YYYY-MM-DD` — e.g. `/history TCS 2026-01-01 2026-03-01`"


class ChatRequest(BaseModel):
    sessionId: str
    messages: list[dict]


class AddStockRequest(BaseModel):
    symbol: str


def _text(message):
    return "".join(p.get("text", "") for p in message.get("parts", []) if p.get("type") == "text")


def _sse(obj):
    return f"data: {json.dumps(obj)}\n\n"


def _live_scrape(symbol):
    """Scrapes+analyzes a symbol on demand from the user's prompt and caches it like a normal scan."""
    news = scraper.get_news(symbol)
    financials = scraper.get_financials(symbol)
    if not news and not financials.get("sector"):
        return None
    markdown = llm.build_markdown(symbol, financials, news)
    db.insert_scraped_item(symbol, markdown, llm.embed(markdown))
    return markdown


@app.post("/api/stocks")
def add_stock(req: AddStockRequest):
    """Manually add a stock by symbol and scrape it live, same path the chat uses on-demand."""
    symbol = req.symbol.strip().upper()
    markdown = _live_scrape(symbol)
    if markdown is None:
        raise HTTPException(status_code=404, detail=f"No data found for '{symbol}' on NSE")
    return {"symbol": symbol, "content_markdown": markdown}


@app.delete("/api/stocks/{symbol}")
def delete_stock(symbol: str):
    db.delete_symbol(symbol.upper())
    return {"ok": True}


@app.get("/api/stocks")
def stocks():
    """Tracked symbols with live price. ponytail: N sequential yahoo calls - fine for a handful of symbols."""
    rows = db.list_symbols()
    for row in rows:
        try:
            row.update(scraper.get_price(row["symbol"]))
        except Exception:
            row.update({"price": None, "changePercent": None})
    return rows


@app.get("/api/stocks/{symbol}")
def stock_detail(symbol: str):
    try:
        quote = scraper.get_quote(symbol)
    except Exception:
        quote = {}
    try:
        news = scraper.get_news(symbol)
    except Exception:
        news = []
    return {"quote": quote, "news": news, "reports": db.list_items_for_symbol(symbol)}


@app.get("/api/stocks/{symbol}/chart")
def stock_chart(symbol: str, range: str = "1mo"):
    if range not in scraper.CHART_RANGES:
        raise HTTPException(status_code=400, detail=f"range must be one of {list(scraper.CHART_RANGES)}")
    return scraper.get_chart(symbol.upper(), range)


@app.get("/api/reports")
def reports(limit: int = 20):
    return db.list_recent_items(limit)


@app.delete("/api/reports/{item_id}")
def delete_report(item_id: int):
    db.delete_item(item_id)
    return {"ok": True}


@app.get("/api/chat/sessions")
def sessions():
    return db.list_sessions()


@app.get("/api/chat/sessions/{session_id}/messages")
def messages(session_id: str):
    return [
        {"id": str(uuid.uuid4()), "role": m["role"], "parts": [{"type": "text", "text": m["content"]}]}
        for m in db.list_messages(session_id)
    ]


def _history_reply(user_text):
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
    markdown = llm.build_history_markdown(symbol, history)
    db.insert_scraped_item(symbol, markdown, llm.embed(markdown))
    return markdown


@app.post("/api/chat")
def post_chat(req: ChatRequest):
    is_new = len(req.messages) == 1
    db.ensure_session(req.sessionId)

    user_text = _text(req.messages[-1])

    reply = _history_reply(user_text)
    if reply is None:
        live_reports = list(filter(None, (
            _live_scrape(symbol) for symbol in dict.fromkeys(TICKER_PATTERN.findall(user_text))
        )))

        query_embedding = llm.embed(user_text)
        matches = db.similarity_search(query_embedding, limit=5)
        stored = [m["content_markdown"] for m in matches if m["content_markdown"] not in live_reports]
        context = "\n\n---\n\n".join(live_reports + stored) or None

        history = [{"role": m["role"], "content": _text(m)} for m in req.messages]
        reply = llm.chat(history, context)

    db.add_message(req.sessionId, "user", user_text)
    db.add_message(req.sessionId, "assistant", reply)

    def stream():
        yield _sse({"type": "start", "messageId": str(uuid.uuid4())})
        text_id = str(uuid.uuid4())
        yield _sse({"type": "text-start", "id": text_id})
        yield _sse({"type": "text-delta", "id": text_id, "delta": reply})
        yield _sse({"type": "text-end", "id": text_id})
        if is_new:
            title = llm.auto_title(user_text)
            db.set_session_title(req.sessionId, title)
            yield _sse({"type": "data-title", "data": {"title": title}})
        yield _sse({"type": "finish"})
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"x-vercel-ai-ui-message-stream": "v1"}
    )

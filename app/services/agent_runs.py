"""Agent turns that outlive the browser tab that started them.

The chat widget's own path (app/routers/chat.py) runs the agent INSIDE the streaming response, so
navigating away or closing the tab kills it mid-tool-call. That is fine for a question you are
watching and wrong for "scan my watchlist and tell me what moved", which is the kind of thing the
agent page is for.

So a run here is a row, not a request. POST starts a daemon thread and returns immediately; the
thread drives the agent loop and writes every tool call to chat_tool_calls as it happens. The
browser subscribes to an SSE feed that REPLAYS what is already stored and then follows along, so
reconnecting after a refresh - or opening the same run in a second window - shows the whole run
rather than whatever is left of it.

ponytail: the follow half polls the run's rows every POLL_SECONDS instead of a pub/sub. A run
produces a handful of tool calls over seconds-to-minutes, so this is a few cheap indexed reads,
and it has the property an in-process queue does not - a subscriber that arrives late, or after a
restart, still sees everything. Swap for LISTEN/NOTIFY if runs ever get chatty.
"""
import threading
import time
import uuid

from app.core import db, llm
from app.services.agent import AGENT_SYSTEM, AGENT_TOOL_IMPLS, AGENT_TOOLS

POLL_SECONDS = 0.4
#: How long a follower waits on a run that never finishes (a wedged upstream call) before giving
#: up on it. The row stays 'running' - this only ends the HTTP stream, not the thread.
FOLLOW_TIMEOUT_SECONDS = 900


def stream_and_persist(run_id, messages, model, tools=AGENT_TOOLS, impls=AGENT_TOOL_IMPLS):
    """llm.run_agent_stream, with every call written to chat_tool_calls as it starts and finishes.

    A generator that yields its source's events unchanged, so the same function serves the live
    streaming path and the background thread - the two cannot drift into persisting different
    things because there is only one of them.
    """
    seq = 0
    for event in llm.run_agent_stream(messages, tools, impls, model):
        if event[0] == "tool":
            _, call_id, name, args, round_ = event
            db.start_tool_call(run_id, call_id, round_, seq, name, args)
            seq += 1
        elif event[0] == "tool_result":
            _, call_id, result, _round = event
            # A tool that raised is reported by run_agent_stream as a string beginning "tool '...'
            # failed:" rather than by raising - keep that as the row's error so the diagram can
            # colour the node red instead of showing the message as a successful result.
            failed = isinstance(result, str) and result.startswith(("tool '", "unknown tool "))
            db.finish_tool_call(run_id, call_id, None if failed else result, result if failed else None)
        yield event


def start(session_id, prompt, model, history):
    """Kicks off a run in the background and returns its id immediately.

    `history` is the already-windowed conversation (see chat.py's _windowed_history) - built by
    the caller, which is the only side that knows what the client has on screen.
    """
    run_id = str(uuid.uuid4())
    db.ensure_session(session_id)
    db.create_run(run_id, session_id, prompt, model)
    db.add_message(session_id, "user", prompt)

    messages = [{"role": "system", "content": AGENT_SYSTEM}] + history

    def work():
        reply, error = "", None
        try:
            for event in stream_and_persist(run_id, messages, model):
                if event[0] == "done":
                    reply = event[1]
        except Exception as e:  # noqa: BLE001 - a dead provider must finish the run, not vanish
            error = str(e)
        db.finish_run(run_id, reply=reply or None, error=error)
        if reply or error:
            db.add_message(session_id, "assistant", reply or f"⚠️ {error}")

    threading.Thread(target=work, daemon=True).start()
    return run_id


def follow(run_id):
    """Replay-then-follow: every event already stored, then new ones as they land, then the final
    answer. Yields plain dicts; the router wraps them as SSE.

    Emitting a tool's start and its finish as separate events is what lets a reconnect show a call
    that is still in flight as in-flight, rather than as either missing or already done.
    """
    seen_started, seen_finished = set(), set()
    deadline = time.monotonic() + FOLLOW_TIMEOUT_SECONDS

    while True:
        run = db.get_run(run_id)
        if run is None:
            yield {"type": "error", "error": "no such run"}
            return

        for call in db.list_tool_calls(run_id):
            if call["call_id"] not in seen_started:
                seen_started.add(call["call_id"])
                yield {"type": "tool-input-available", "toolCallId": call["call_id"],
                       "toolName": call["name"], "input": call["args"] or {}, "round": call["round"]}
            if call["finished_at"] and call["call_id"] not in seen_finished:
                seen_finished.add(call["call_id"])
                yield {"type": "tool-output-available", "toolCallId": call["call_id"],
                       "output": call["error"] or call["result"], "isError": bool(call["error"])}

        if run["status"] != "running":
            yield {"type": "done", "status": run["status"],
                   "reply": run["reply"], "error": run["error"]}
            return
        if time.monotonic() > deadline:
            yield {"type": "error", "error": "stopped watching this run - it is taking unusually long"}
            return
        time.sleep(POLL_SECONDS)

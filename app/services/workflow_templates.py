"""Workflows that already work, so the first one isn't a blank canvas.

A node editor is a feature people admire and don't use: the distance from "empty grid" to "thing
that helps me" is where it dies. These are three graphs that do real jobs on this app's own data -
clone one, point it at your watchlist, arm it.

Each is deliberately built around a `condition` node, because that is the habit worth teaching:
a workflow that files something every morning is another inbox, and one that files only when a
number crosses a line is what lets you stop looking.
"""

#: Laid out left to right in the same columns the executor runs them in, so a cloned template
#: opens looking like the diagram of its own run rather than like a pile.
def _at(column, row=0):
    return {"x": column * 260, "y": row * 130}


TEMPLATES = [
    {
        "id": "morning-movers",
        "name": "Morning movers",
        "description": "Every trading morning: the day's biggest movers, but only tell me if "
                       "something moved more than 5%.",
        "trigger": {"kind": "schedule", "time": "09:30"},
        "graph": {
            "nodes": [
                {"id": "t", "kind": "trigger", "position": _at(0),
                 "data": {"label": "Every morning 09:30"}},
                {"id": "movers", "kind": "tool", "position": _at(1),
                 "data": {"label": "Top movers", "tool": "get_movers", "args": {"count": "10"}}},
                {"id": "keep", "kind": "collect", "position": _at(2),
                 "data": {"label": "Keep the numbers", "series": "movers", "rows": "{{ movers }}"}},
                {"id": "gate", "kind": "condition", "position": _at(3),
                 "data": {"label": "Anything big?", "left": "{{ movers }}", "op": "not_empty"}},
                {"id": "say", "kind": "agent", "position": _at(4),
                 "data": {"label": "Summarise",
                          "prompt": "Here are today's NSE movers: {{ movers }}\n\nIn three bullets, "
                                    "say what stands out. Use ₹, never $. No investment advice."}},
                {"id": "file", "kind": "output", "position": _at(5),
                 "data": {"label": "File it", "message": "{{ say }}"}},
            ],
            "edges": [
                {"id": "e1", "source": "t", "target": "movers"},
                {"id": "e2", "source": "movers", "target": "keep"},
                {"id": "e3", "source": "movers", "target": "gate"},
                {"id": "e4", "source": "gate", "target": "say"},
                {"id": "e5", "source": "say", "target": "file"},
            ],
        },
    },
    {
        "id": "watchlist-prices",
        "name": "Watchlist price log",
        "description": "Logs every watchlisted stock's price once a day, so the Data tab has a "
                       "series to chart. Files nothing - it just remembers.",
        "trigger": {"kind": "schedule", "time": "16:00"},
        "graph": {
            "nodes": [
                {"id": "t", "kind": "trigger", "position": _at(0),
                 "data": {"label": "Every day 16:00"}},
                {"id": "lists", "kind": "tool", "position": _at(1),
                 "data": {"label": "My watchlists", "tool": "list_watchlists", "args": {}}},
                # The fan-out: one node, one call per symbol. This is the "8 items" on the wire.
                {"id": "price", "kind": "tool", "position": _at(2),
                 "data": {"label": "Price each", "tool": "get_price",
                          "for_each": "{{ lists.symbols }}", "args": {"symbol": "{{ item }}"}}},
                {"id": "keep", "kind": "collect", "position": _at(3),
                 "data": {"label": "Log it", "series": "prices", "rows": "{{ price }}"}},
            ],
            "edges": [
                {"id": "e1", "source": "t", "target": "lists"},
                {"id": "e2", "source": "lists", "target": "price"},
                {"id": "e3", "source": "price", "target": "keep"},
            ],
        },
    },
    {
        "id": "event-triage",
        "name": "Event triage",
        "description": "After the daily event scan, reads what landed and files a summary only if "
                       "there is something negative worth knowing.",
        "trigger": {"kind": "event_scan"},
        "graph": {
            "nodes": [
                {"id": "t", "kind": "trigger", "position": _at(0),
                 "data": {"label": "After the event scan"}},
                {"id": "scan", "kind": "tool", "position": _at(1),
                 "data": {"label": "Today's events", "tool": "scan_events", "args": {}}},
                {"id": "gate", "kind": "condition", "position": _at(2),
                 "data": {"label": "Anything negative?", "left": "{{ scan }}",
                          "op": "contains", "right": "negative"}},
                {"id": "say", "kind": "agent", "position": _at(3),
                 "data": {"label": "What matters",
                          "prompt": "These events just landed on my watchlist: {{ scan }}\n\n"
                                    "List only the ones that are genuinely bad news for the "
                                    "holder, one line each, with the ticker first. If none are, "
                                    "say so in one line."}},
                {"id": "file", "kind": "output", "position": _at(4),
                 "data": {"label": "Tell me", "message": "{{ say }}"}},
            ],
            "edges": [
                {"id": "e1", "source": "t", "target": "scan"},
                {"id": "e2", "source": "scan", "target": "gate"},
                {"id": "e3", "source": "gate", "target": "say"},
                {"id": "e4", "source": "say", "target": "file"},
            ],
        },
    },
]

TEMPLATES_BY_ID = {t["id"]: t for t in TEMPLATES}

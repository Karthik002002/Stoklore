"""Workflows that already work, so the first one isn't a blank canvas.

A node editor is a feature people admire and don't use: the distance from "empty grid" to "thing
that helps me" is where it dies. These are graphs that do real jobs on this app's own data - clone
one, adjust it, arm it.

Two rules every template here follows, and tests/workflow_templates.selfcheck.py enforces:

1. **Every `{{ reference }}` is to a node it is wired to**, and every path matches what that tool
   actually returns. Two of the first three templates broke this - one fanned out over a field a
   list doesn't have, one gated on the reply of a tool that returns before doing its work - and
   both "ran" without complaint while doing nothing. The self-check runs each template against
   fakes shaped like the real tools, so that class of bug fails a test instead of a morning.
2. **Anything that alerts is gated.** An agent node answers with NOTHING_TO_REPORT when nothing
   qualifies, and a `not_contains` condition drops the branch. A workflow that files something
   every day is another inbox; one that files only when something happened lets you stop looking.
"""

from app.core import scraper

#: What an agent node answers when nothing qualifies. A sentinel rather than "none": "none of the
#: others moved" is ordinary prose, and gating on it would silence a real finding.
QUIET = "NOTHING_TO_REPORT"
_QUIET_RULE = f"\n\nIf nothing qualifies, reply with exactly {QUIET} and nothing else."
_HOUSE_STYLE = " Use ₹, never $. Be concrete - tickers and numbers. No investment advice."


def _at(column, row=0):
    """Laid out in the columns the executor runs them in, so a clone opens looking like the diagram
    of its own run rather than like a pile."""
    return {"x": column * 260, "y": row * 130}


def _node(node_id, kind, column, row=0, **data):
    return {"id": node_id, "kind": kind, "position": _at(column, row), "data": data}


def _edges(*pairs):
    return [{"id": f"e-{a}-{b}", "source": a, "target": b} for a, b in pairs]


def _gated_alert(source, prompt, column):
    """agent -> quiet gate -> file it. The tail almost every alerting template shares."""
    return (
        [
            _node("say", "agent", column, label="Decide", prompt=prompt + _HOUSE_STYLE + _QUIET_RULE),
            _node("gate", "condition", column + 1, label="Anything?", left="{{ say }}",
                  op="not_contains", right=QUIET),
            _node("file", "output", column + 2, label="Tell me", message="{{ say }}"),
        ],
        # file reads {{ say }}, so it is wired to say as well as to the gate. The gate still decides
        # whether it runs - a node with ANY parent switched off is skipped - but a node only SEES
        # what it is wired to, and a gate-only edge filed an empty message.
        [(source, "say"), ("say", "gate"), ("gate", "file"), ("say", "file")],
    )


def _template(template_id, name, category, description, trigger, nodes, pairs):
    return {"id": template_id, "name": name, "category": category, "description": description,
            "trigger": trigger, "graph": {"nodes": nodes, "edges": _edges(*pairs)}}


def _daily(time):
    return {"kind": "schedule", "time": time}


def screen_graph(url, name, max_pages=2):
    """A screener.in screen as a workflow: run it, keep what it matched, and summarise the best of it
    only when it matched anything. Shared by the screen templates below and by "generate from a
    screen" (POST /api/workflows/from-screen), so a pasted screen and a shipped one are the same graph.
    """
    nodes = [
        _node("t", "trigger", 0, label="Daily"),
        _node("screen", "tool", 1, label=name[:40], tool="run_screen",
              args={"url": url, "max_pages": str(max_pages)}),
        _node("keep", "collect", 2, 1, label="Keep matches", series="matches", rows="{{ screen.rows }}"),
        _node("any", "condition", 2, label="Any matches?", left="{{ screen.rows }}", op="not_empty"),
    ]
    tail, tail_pairs = _gated_alert(
        "any",
        f"These companies currently match the screener.in screen '{name}': {{{{ screen.rows }}}}\n\n"
        "Pick the five that look strongest on the numbers shown and give one line each: ticker "
        "(or name), the two figures that make it stand out.",
        3,
    )
    # The summary reads the screen, so it has to be wired to it as well as to the gate that
    # decides whether it runs - a node only sees what it is wired to.
    return nodes + tail, [("t", "screen"), ("screen", "keep"), ("screen", "any"), ("screen", "say")] + tail_pairs


def _screen_template(template_id, url, name, description, time, max_pages=2):
    nodes, pairs = screen_graph(url, name, max_pages)
    return _template(template_id, name, "Screener", description, _daily(time), nodes, pairs)


# --- market -----------------------------------------------------------------------------------------

_movers_alert = _gated_alert(
    "movers",
    "Today's NSE movers (symbol, changePercent, volume, avgVolume): {{ movers }}\n\n"
    "List only stocks that moved more than 5% either way, biggest first, one line each.",
    2,
)
_volume_alert = _gated_alert(
    "movers",
    "Today's NSE movers (symbol, changePercent, volume, avgVolume): {{ movers }}\n\n"
    "List only stocks trading at least 3x their average volume, with the multiple and the "
    "price change, one line each.",
    2,
)

# --- watchlist ---------------------------------------------------------------------------------------
# list_watchlists returns [{symbol, list_name}, ...] - a list, so fan-outs point at the node itself and
# read {{ item.symbol }}. (Not {{ lists.symbols }}: a list has no fields, and that resolves to nothing.)


def _watchlist_fanout(tool, args, label):
    return [
        _node("t", "trigger", 0, label="Daily"),
        _node("lists", "tool", 1, label="My watchlist", tool="list_watchlists", args={}),
        _node("each", "tool", 2, label=label, tool=tool, for_each="{{ lists }}", args=args),
    ], [("t", "lists"), ("lists", "each")]


def _watchlist_alert(tool, args, label, prompt):
    nodes, pairs = _watchlist_fanout(tool, args, label)
    tail, tail_pairs = _gated_alert("each", prompt, 3)
    return nodes + tail, pairs + tail_pairs


TEMPLATES = [
    # Market
    _template(
        "morning-movers", "Morning movers", "Market",
        "The day's biggest NSE movers every morning - but it only tells you when something moved "
        "more than 5%.",
        _daily("09:30"),
        [_node("t", "trigger", 0, label="Every morning"),
         _node("movers", "tool", 1, label="Top movers", tool="get_movers", args={"count": "25"}),
         _node("keep", "collect", 2, 1, label="Keep them", series="movers", rows="{{ movers }}"),
         *_movers_alert[0]],
        [("t", "movers"), ("movers", "keep"), *_movers_alert[1]],
    ),
    _template(
        "volume-spikes", "Volume spikes", "Market",
        "Late morning, flags stocks trading at 3x+ their average volume. Silent otherwise.",
        _daily("11:00"),
        [_node("t", "trigger", 0, label="Late morning"),
         _node("movers", "tool", 1, label="Movers", tool="get_movers", args={"count": "50"}),
         *_volume_alert[0]],
        [("t", "movers"), *_volume_alert[1]],
    ),
    _template(
        "market-open-brief", "Market open brief", "Market",
        "Movers and yesterday's watchlist events, merged into one short brief at the open. Always "
        "files - a brief is the point.",
        _daily("09:20"),
        [_node("t", "trigger", 0, label="At the open"),
         _node("movers", "tool", 1, 0, label="Movers", tool="get_movers", args={"count": "15"}),
         _node("events", "tool", 1, 1, label="Recent events", tool="get_recent_events",
               args={"days": "1"}),
         _node("say", "agent", 2, label="Brief",
               prompt="Market movers: {{ movers }}\n\nMy watchlist's events from the last day: "
                      "{{ events }}\n\nWrite a five-bullet opening brief: what's moving, and "
                      "anything on my watchlist that needs a look." + _HOUSE_STYLE),
         _node("file", "output", 3, label="File the brief", message="{{ say }}")],
        [("t", "movers"), ("t", "events"), ("movers", "say"), ("events", "say"), ("say", "file")],
    ),
    _template(
        "movers-log", "Movers log", "Market",
        "Logs the day's top 25 movers after the close. Files nothing - it builds a series for the "
        "Data tab.",
        _daily("15:35"),
        [_node("t", "trigger", 0, label="After the close"),
         _node("movers", "tool", 1, label="Top movers", tool="get_movers", args={"count": "25"}),
         _node("keep", "collect", 2, label="Log them", series="movers", rows="{{ movers }}")],
        [("t", "movers"), ("movers", "keep")],
    ),
    # Watchlist
    _template(
        "watchlist-prices", "Watchlist price log", "Watchlist",
        "Every watchlisted stock's price once a day, so the Data tab has a line to chart. Files "
        "nothing - it just remembers.",
        _daily("16:00"),
        *(lambda n, p: (n + [_node("keep", "collect", 3, label="Log it", series="prices",
                                   rows="{{ each }}")], p + [("each", "keep")]))(
            *_watchlist_fanout("get_price", {"symbol": "{{ item.symbol }}"}, "Price each")
        ),
    ),
    _template(
        "watchlist-big-moves", "Watchlist big moves", "Watchlist",
        "Prices your whole watchlist mid-afternoon and tells you only about stocks that moved more "
        "than 4%.",
        _daily("15:00"),
        *_watchlist_alert(
            "get_price", {"symbol": "{{ item.symbol }}"}, "Price each",
            "Today's prices for my watchlist (symbol, price, changePercent): {{ each }}\n\n"
            "List only the stocks that moved more than 4% either way, one line each.",
        ),
    ),
    _template(
        "golden-cross-scan", "Golden & death crosses", "Watchlist",
        "Checks the 20/50 EMA on every watchlisted stock and tells you only when one crossed on "
        "the latest bar. Needs synced price history.",
        _daily("16:15"),
        *_watchlist_alert(
            "get_ema_crossover", {"symbol": "{{ item.symbol }}", "short": "20", "long": "50"},
            "EMA each",
            "EMA 20/50 readings for my watchlist, in watchlist order: {{ each }}\n\nList only "
            "stocks where a crossover happened on the latest bar, saying golden or death cross.",
        ),
    ),
    _template(
        "watchlist-news-sweep", "Watchlist news sweep", "Watchlist",
        "Searches the news for every watchlisted stock each evening and reports only what's "
        "material - results, orders, management, regulators.",
        _daily("18:00"),
        *_watchlist_alert(
            "web_search", {"query": "{{ item.symbol }} NSE share news"}, "Search each",
            "News search results for each of my watchlisted stocks, in watchlist order: "
            "{{ each }}\n\nReport only material news - results, big orders, management changes, "
            "regulatory action. One line per stock, with the source.",
        ),
    ),
    _template(
        "watch-rule-check", "Watch rule check", "Watchlist",
        "Checks a watch rule against the whole watchlist and files the result only when some "
        "stock meets it. Edit the rule name to one from Settings › Watch rules.",
        _daily("15:15"),
        [_node("t", "trigger", 0, label="Daily"),
         _node("rule", "tool", 1, label="Check rule", tool="check_watch_rule",
               args={"name": "buy dip"}),
         # The rule tool answers in markdown, with a ✅ per stock that meets it - so that mark IS
         # the signal. There are no fields to test.
         _node("gate", "condition", 2, label="Anyone met it?", left="{{ rule }}", op="contains",
               right="✅"),
         _node("file", "output", 3, label="Tell me", message="{{ rule }}")],
        [("t", "rule"), ("rule", "gate"), ("gate", "file"), ("rule", "file")],
    ),
    # Events
    _template(
        "event-triage", "Event triage", "Events",
        "After the daily event scan, reads what landed and files a summary only if something "
        "negative came in.",
        {"kind": "event_scan"},
        [_node("t", "trigger", 0, label="After the event scan"),
         # get_recent_events, not scan_events: the scan starts in the background and returns at
         # once, so gating on ITS reply meant this template could never fire.
         _node("events", "tool", 1, label="Today's events", tool="get_recent_events",
               args={"days": "1"}),
         _node("neg", "condition", 2, label="Anything negative?", left="{{ events }}",
               op="contains", right="negative"),
         _node("say", "agent", 3, label="What matters",
               prompt="These events just landed on my watchlist: {{ events }}\n\nList only the "
                      "ones that are genuinely bad news for a holder, one line each, ticker "
                      "first." + _HOUSE_STYLE),
         _node("file", "output", 4, label="Tell me", message="{{ say }}")],
        [("t", "events"), ("events", "neg"), ("neg", "say"), ("events", "say"), ("say", "file")],
    ),
    _template(
        "events-log", "Events log", "Events",
        "Keeps every day's watchlist events as a series after the scan - a record you can sort and "
        "chart by sentiment. Files nothing.",
        {"kind": "event_scan"},
        [_node("t", "trigger", 0, label="After the event scan"),
         _node("events", "tool", 1, label="Today's events", tool="get_recent_events",
               args={"days": "1"}),
         _node("keep", "collect", 2, label="Log them", series="events", rows="{{ events }}")],
        [("t", "events"), ("events", "keep")],
    ),
    # Portfolio
    _template(
        "holdings-log", "Holdings log", "Portfolio",
        "Snapshots your broker holdings after the close, so P&L per position becomes a series. "
        "Needs a broker connected in Settings.",
        _daily("15:45"),
        [_node("t", "trigger", 0, label="After the close"),
         _node("h", "tool", 1, label="Holdings", tool="get_holdings", args={}),
         _node("keep", "collect", 2, label="Snapshot", series="holdings", rows="{{ h.holdings }}")],
        [("t", "h"), ("h", "keep")],
    ),
    _template(
        "holdings-drawdown", "Holdings drawdown", "Portfolio",
        "Tells you when any position you hold is more than 8% below your average price. Silent "
        "otherwise.",
        _daily("15:40"),
        [_node("t", "trigger", 0, label="Near the close"),
         _node("h", "tool", 1, label="Holdings", tool="get_holdings", args={}),
         *_gated_alert(
             "h",
             "My current holdings: {{ h.holdings }}\n\nList only positions whose last price "
             "(ltp) is more than 8% below my average buy price, with the percentage.",
             2,
         )[0]],
        [("t", "h"), *_gated_alert("h", "", 2)[1]],
    ),
    # Screener
    _screen_template(
        "screen-promoter-holding", "https://www.screener.in/screens/3908349/promoter-share-holding-finder/",
        "Promoter share holding finder",
        "Companies where promoters hold 40%+, unpledged, and raised their stake by 5%+. Runs after "
        "screener refreshes in the evening.",
        "19:00",
    ),
    _screen_template(
        "screen-swing-trading", "https://www.screener.in/screens/3797537/swing-trading-12-weeks/",
        "Swing trading (1–2 weeks)",
        "Quality mid-and-large caps - 3y sales and profit growth, high ROE/ROCE, low debt - ready "
        "for the morning before the open.",
        "08:45",
    ),
    _screen_template(
        "screen-quarterly-growers", "https://www.screener.in/screens/86/quarterly-growers/",
        "Quarterly growers",
        "Net profit up for three quarters running. A big screen (300+ results), so it reads the "
        "first two pages of 50.",
        "19:30",
        max_pages=2,
    ),
]

TEMPLATES_BY_ID = {t["id"]: t for t in TEMPLATES}
CATEGORIES = list(dict.fromkeys(t["category"] for t in TEMPLATES))

# A screen template's URL is fetched server-side, so it has to pass the same guard a pasted one does.
for _t in TEMPLATES:
    for _n in _t["graph"]["nodes"]:
        if _n["data"].get("tool") == "run_screen":
            scraper.screen_url(_n["data"]["args"]["url"])

"""Typed classification with Laya - a local, non-autoregressive decision model (the open-source
alternative to Jev). It answers a question about a piece of text in one forward pass, with a
calibrated confidence, and never generates text:

    choice  pick one label           -> {"choice", "probabilities", "confidence"}
    score   a point on an ordinal scale -> {"score" (expected index), "legend", "confidence"}
    noul    yes/no                   -> {"noul" (probability of yes), "confidence"}

It sits beside the chat LLM, not instead of it: guard rails on chat input and tool results, tags on
scraped news, mistake/emotion suggestions in the trade journal, and a `classify_text` tool the
agent and workflows can call. Every caller treats it as optional - off in Settings, not installed,
or the model failing to load all mean "behave exactly as before", never an error.
"""
import threading
from functools import lru_cache

from app.core import db

MODEL_ID = "convaiinnovations/laya"
SETTING_KEY = "laya_enabled"

# Laya reads up to 512 tokens of state; a character cap keeps the tokenizer from chewing through a
# whole scraped article only to truncate it.
MAX_CHARS = 2500

_load_lock = threading.Lock()


def installed():
    try:
        import laya  # noqa: F401
    except ImportError:
        return False
    return True


def enabled():
    return db.get_setting_value(SETTING_KEY, "false") == "true" and installed()


def set_enabled(on):
    db.set_setting_value(SETTING_KEY, "true" if on else "false")


@lru_cache(maxsize=1)
def _agent():
    # ponytail: loaded lazily on first use and held for the process (~1.7GB, MPS/CUDA when
    # available, else CPU) - same trade as sentiment.py. Turning the setting off stops new calls
    # but doesn't free the memory until restart.
    import laya

    return laya.load(MODEL_ID)


def loaded():
    return _agent.cache_info().currsize > 0


def predict(state, questions):
    """Raw Laya answers, or None when classification is off or unavailable. Never raises: every
    caller has a pre-Laya behaviour to fall back to."""
    if not enabled():
        return None
    try:
        with _load_lock:  # one load, even when the first calls arrive together
            agent = _agent()
        return agent.predict(_clip(state), questions)["answers"]
    except Exception as e:  # noqa: BLE001 - a broken model must never break a chat turn
        print(f"laya: prediction failed: {e}")
        return None


def _clip(state):
    if isinstance(state, str):
        return state[:MAX_CHARS]
    if isinstance(state, dict):
        return {k: (v[:MAX_CHARS] if isinstance(v, str) else v) for k, v in state.items()}
    return state


# --- Generic: one question, any text (the agent / workflow tool) ---------------------------------


def classify(text, question, qtype="choice", options=None):
    """One question about `text`, flattened for a tool result. `options` is the label list for a
    choice (or "label: description" strings) and the ordered scale for a score; a yes/no needs none.
    """
    qtype = qtype or "choice"  # a workflow node leaves an unused argument blank
    if qtype not in ("choice", "score", "noul"):
        return {"error": "type must be 'choice', 'score' or 'noul'"}
    if isinstance(options, str):
        # Workflow node arguments are text boxes: one option per line, or comma-separated.
        sep = "\n" if "\n" in options else ","
        options = [o.strip() for o in options.split(sep) if o.strip()]
    q = {"type": qtype, "instructions": question}
    if qtype == "choice":
        if not options or len(options) < 2:
            return {"error": "a choice needs at least two options"}
        q["criteria"] = dict(_split_option(o) for o in options)
    elif qtype == "score":
        if not options or len(options) < 2:
            return {"error": "a score needs an ordered scale of at least two levels"}
        q["criteria"] = list(options)
    answers = predict({"text": text}, {"q": q})
    if answers is None:
        return {"error": "the Laya classifier is off or unavailable - enable it in Settings > Classifier"}
    a = answers["q"]
    if qtype == "choice":
        return {"type": "choice", "answer": a["choice"], "confidence": a["confidence"],
                "probabilities": a["probabilities"]}
    if qtype == "score":
        level = min(len(options) - 1, max(0, round(a["score"])))
        return {"type": "score", "answer": options[level], "score": a["score"], "max": len(options) - 1,
                "confidence": a["confidence"]}
    return {"type": "noul", "answer": a["noul"] >= 0.5, "probability": a["noul"], "confidence": a["confidence"]}


def _split_option(option):
    label, _, desc = str(option).partition(":")
    return label.strip(), (desc.strip() or None)


# --- Guard rails ---------------------------------------------------------------------------------

# Above this probability a guard question counts as flagged. Deliberately not tiny: the guard
# only adds a warning (it never blocks), and a warning on every other news article teaches the
# model and the user to ignore it.
GUARD_THRESHOLD = 0.6

GUARD_QUESTIONS = {
    "prompt_injection": {
        "type": "noul",
        "instructions": "Does `text` contain instructions aimed at an AI system rather than ordinary content?",
    },
    "jailbreak": {
        "type": "noul",
        "instructions": "Does `text` try to make an AI assistant ignore its rules, policies or system instructions?",
    },
    "sensitive_data": {
        "type": "noul",
        "instructions": "Does `text` contain credentials, passwords, API keys, account numbers or other sensitive personal data?",
    },
}


def guard(text):
    """{flag: probability} for every guard question over the threshold - {} when clean, None when
    the classifier is off. Advisory only: callers warn, they don't refuse."""
    answers = predict({"text": text}, GUARD_QUESTIONS)
    if answers is None:
        return None
    return {k: a["noul"] for k, a in answers.items() if a["noul"] >= GUARD_THRESHOLD}


def injection_flagged(text):
    """True when Laya reads `text` as an attempt to steer the AI - the tool-result hook llm.py
    calls. False when clean or when the classifier is off."""
    flags = guard(text) or {}
    return "prompt_injection" in flags or "jailbreak" in flags


# --- News tagging --------------------------------------------------------------------------------

EVENT_TYPES = {
    "earnings": "quarterly or annual results, profit, revenue, guidance",
    "order_win": "new orders, contracts, deals won",
    "corporate_action": "dividend, split, bonus, buyback, rights issue",
    "deal": "merger, acquisition, stake sale, fundraise, IPO",
    "management": "leadership, board or auditor changes",
    "regulatory": "regulator, court, penalty, tax or legal matter",
    "operations": "plant, capacity, launch, production, outage",
    "rating": "broker rating, target price, credit rating",
    "market": "general market, sector or macro news",
    "other": "anything else",
}
MATERIALITY = ["none: routine or irrelevant", "minor", "moderate", "major: likely to move the stock"]

NEWS_QUESTIONS = {
    "event": {"type": "choice", "instructions": "What kind of event is `news` about?", "criteria": EVENT_TYPES},
    "materiality": {"type": "score", "instructions": "How material is `news` to the company's share price?",
                    "criteria": MATERIALITY},
    # Phrasing matters to this model: "is it price-sensitive information" scored every headline
    # ~0.15; asking whether it could move the price separates an order win (0.63) from market
    # chatter (0.09).
    "price_sensitive": {"type": "noul", "instructions": "Could `news` move the company's share price significantly?"},
}


def tag_news(title, summary=None):
    """{event, event_confidence, materiality (0-3), price_sensitive (probability)} or None."""
    answers = predict({"news": f"{title}. {summary or ''}".strip()}, NEWS_QUESTIONS)
    if answers is None:
        return None
    return {
        "event": answers["event"]["choice"],
        "event_confidence": answers["event"]["confidence"],
        "materiality": answers["materiality"]["score"],
        "price_sensitive": answers["price_sensitive"]["noul"],
    }


_tagging = threading.Lock()


def tag_pending_async():
    """Tags every news row that doesn't have tags yet, in a background thread - a scrape returns
    immediately and the badges appear on the next load. One pass at a time; a call while one is
    running is dropped, since the running pass will reach those rows anyway."""
    if not enabled() or not _tagging.acquire(blocking=False):
        return

    def run():
        try:
            while True:
                rows = db.untagged_news(limit=25)
                if not rows:
                    return
                for row in rows:
                    tags = tag_news(row["title"], row["summary"])
                    if tags is None:  # turned off (or broken) mid-pass
                        return
                    db.set_news_tags(row["table"], row["id"], tags)
        finally:
            _tagging.release()

    threading.Thread(target=run, daemon=True, name="laya-news-tagger").start()


# --- Journal: suggest the review from a trade's notes -------------------------------------------


# What each default mistake means, so the model is choosing between definitions rather than bare
# words. One choice over described labels was near-certain on test notes (a chasing note -> Chasing
# 0.9998, a clean one -> Normal loss 0.9997), where a yes/no per label scored everything ~0.1. A
# label renamed or added in Settings goes in without a description and still works, less sharply.
MISTAKE_HINTS = {
    "Setup": "traded a setup that wasn't valid",
    "Entry": "entered too early or too late",
    "Position sizing": "position too big or too small",
    "Stop": "moved, widened or ignored the stop",
    "Exit": "exited too early or too late",
    "Overtrading": "took too many trades",
    "Chasing": "chased a move that had already run",
    "FOMO": "fear of missing out",
    "Revenge trading": "trading to win back a loss",
    "Rule violation": "broke a trading rule",
    "Normal loss": "followed the plan and still lost",
}

# A second mistake is suggested only when the model gives it real weight too.
SECOND_MISTAKE_MIN = 0.2


def suggest_review(notes, mistakes, emotions):
    """What a trade's own notes suggest for its review: the main mistake (plus a second when it's
    close), and the emotion. Suggestions for the form to pre-select - nothing is saved from here."""
    questions = {}
    if len(mistakes) >= 2:
        questions["mistake"] = {
            "type": "choice",
            "instructions": "Which trading mistake does `notes` describe?",
            "criteria": {m: MISTAKE_HINTS.get(m) for m in mistakes},
        }
    if len(emotions) >= 2:
        questions["emotion"] = {
            "type": "choice",
            "instructions": "Which emotion best describes the trader in `notes`?",
            "criteria": {e: None for e in emotions},
        }
    if not questions:
        return {"mistakes": [], "emotion": None}
    answers = predict({"notes": notes}, questions)
    if answers is None:
        return None
    picked = []
    if "mistake" in answers:
        ranked = sorted(answers["mistake"]["probabilities"].items(), key=lambda kv: -kv[1])
        picked = [{"label": m, "probability": p} for m, p in ranked[:2] if m == ranked[0][0] or p >= SECOND_MISTAKE_MIN]
    return {
        "mistakes": picked,
        "emotion": (
            {"label": answers["emotion"]["choice"], "confidence": answers["emotion"]["confidence"]}
            if "emotion" in answers else None
        ),
    }

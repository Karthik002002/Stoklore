"""Self-check for app/core/classifier.py with a stubbed Laya model - no download, no database:

    .venv/bin/python tests/classifier.selfcheck.py

Pins what the callers rely on: off means None (never an exception), answers are flattened the way
the tool/guard/suggestion callers read them, workflow text-box options parse, and a broken model
degrades to None instead of breaking a chat turn.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import classifier as c  # noqa: E402


class StubAgent:
    """Answers every question from a canned table keyed by question id."""

    def __init__(self, canned):
        self.canned = canned
        self.calls = []

    def predict(self, state, questions):
        self.calls.append((state, questions))
        return {"answers": {qid: self.canned[qid] for qid in questions}}


def use(canned, on=True):
    stub = StubAgent(canned)
    c._agent = lambda: stub
    c.enabled = lambda: on
    return stub


# Off -> None everywhere, and the model is never touched.
stub = use({}, on=False)
assert c.predict("x", {"q": {}}) is None
assert c.guard("x") is None and c.injection_flagged("x") is False
assert c.tag_news("t") is None and c.suggest_review("n", ["A", "B"], []) is None
assert "error" in c.classify("x", "q?", "noul")
assert stub.calls == []

# classify: choice, with "label: description" options from a workflow text box.
stub = use({"q": {"choice": "IT", "probabilities": {"IT": 0.9, "Bank": 0.1}, "confidence": 0.8}})
r = c.classify("Coforge wins deal", "Which sector is `text` about?", "choice", "IT: software, Bank")
assert r == {"type": "choice", "answer": "IT", "confidence": 0.8, "probabilities": {"IT": 0.9, "Bank": 0.1}}, r
assert stub.calls[0][1]["q"]["criteria"] == {"IT": "software", "Bank": None}
# Newline-separated wins over commas, so a description may contain a comma.
c.classify("x", "q", "choice", "IT: software, services\nBank")
assert stub.calls[1][1]["q"]["criteria"] == {"IT": "software, services", "Bank": None}
# Blank type (an unused workflow argument) means choice.
assert c.classify("x", "q", "", ["IT", "Bank"])["type"] == "choice"

# score: the expected index is rounded onto the caller's own scale.
use({"q": {"score": 1.6, "confidence": 0.4}})
r = c.classify("x", "How bad?", "score", ["mild", "notable", "severe"])
assert r["answer"] == "severe" and r["max"] == 2, r

# noul: probability kept, answer is the 0.5 cut.
use({"q": {"noul": 0.42, "confidence": 0.58}})
assert c.classify("x", "Is it?", "noul") == {"type": "noul", "answer": False, "probability": 0.42, "confidence": 0.58}

# Bad input is an error dict, not an exception.
assert "error" in c.classify("x", "q", "choice", ["only one"])
assert "error" in c.classify("x", "q", "vote")

# guard: only flags over the threshold come back.
use({"prompt_injection": {"noul": 0.95}, "jailbreak": {"noul": 0.3}, "sensitive_data": {"noul": 0.61}})
assert c.guard("x") == {"prompt_injection": 0.95, "sensitive_data": 0.61}
assert c.injection_flagged("x") is True
use({"prompt_injection": {"noul": 0.1}, "jailbreak": {"noul": 0.1}, "sensitive_data": {"noul": 0.9}})
assert c.injection_flagged("x") is False  # credentials alone aren't an injection

# Long text is clipped before it reaches the tokenizer.
stub = use({"prompt_injection": {"noul": 0}, "jailbreak": {"noul": 0}, "sensitive_data": {"noul": 0}})
c.guard("a" * 10_000)
assert len(stub.calls[0][0]["text"]) == c.MAX_CHARS

# tag_news flattens the three answers.
use({"event": {"choice": "order_win", "confidence": 0.86}, "materiality": {"score": 2.5},
     "price_sensitive": {"noul": 0.63}})
assert c.tag_news("Coforge bags deal") == {"event": "order_win", "event_confidence": 0.86,
                                           "materiality": 2.5, "price_sensitive": 0.63}

# suggest_review: top mistake always, a second only when it carries real weight.
canned = {"mistake": {"probabilities": {"Chasing": 0.7, "FOMO": 0.25, "Exit": 0.05}},
          "emotion": {"choice": "FOMO", "confidence": 0.82}}
stub = use(canned)
r = c.suggest_review("chased it", ["Chasing", "FOMO", "Exit"], ["Calm", "FOMO"])
assert [m["label"] for m in r["mistakes"]] == ["Chasing", "FOMO"], r
assert r["emotion"] == {"label": "FOMO", "confidence": 0.82}
assert stub.calls[0][1]["mistake"]["criteria"]["Chasing"] == c.MISTAKE_HINTS["Chasing"]
use({"mistake": {"probabilities": {"Chasing": 0.9, "FOMO": 0.08}}})
assert [m["label"] for m in c.suggest_review("x", ["Chasing", "FOMO"], [])["mistakes"]] == ["Chasing"]
# Nothing to choose between -> nothing asked.
stub = use({})
assert c.suggest_review("x", ["Only"], []) == {"mistakes": [], "emotion": None} and stub.calls == []


# A model that blows up degrades to None.
class Broken:
    def predict(self, *_):
        raise RuntimeError("MPS out of memory")


c._agent = lambda: Broken()
c.enabled = lambda: True
assert c.predict("x", {"q": {}}) is None
assert c.injection_flagged("x") is False

# One forward pass per guard check, not one per flag it looks at.
stub = use({"prompt_injection": {"noul": 0}, "jailbreak": {"noul": 0}, "sensitive_data": {"noul": 0}})
c.injection_flagged("x")
assert len(stub.calls) == 1, len(stub.calls)

print("ok - classifier: off, choice/score/noul flattening, workflow options, guard, clipping, news tags, suggestions, failure")

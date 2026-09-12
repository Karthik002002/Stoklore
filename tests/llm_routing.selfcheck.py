"""Which backend a model id is routed to, and how OmniRoute is addressed. Plain asserts, no
framework, no network:

    .venv/bin/python tests/llm_routing.selfcheck.py

Routing in llm.py is a prefix check repeated at every call site, and OmniRoute is the fall-through
- so a model id that grows a new prefix silently changes provider. These pin the three branches,
the auth header (an endpoint key is optional for a local gateway and required for a remote one),
and that the `auto` aliases reach the gateway verbatim: `auto/chat:free` only means "free tier
only" if the suffix survives the trip.
"""
import io
import json
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import llm  # noqa: E402

sent = {}


def fake_post(base, path, body, headers=None, timeout=120):
    sent.update(base=base, path=path, body=body, headers=headers or {})
    return {"choices": [{"message": {"content": "hi", "role": "assistant"}}]}


llm._post = fake_post

# --- the base URL: nothing configured is a working default, not an error ------------------------
llm.configure_omniroute(None, None)
assert llm.OMNIROUTE_BASE == llm.DEFAULT_OMNIROUTE_BASE, "a local gateway needs no settings at all"
llm.configure_omniroute("", None)
assert llm.OMNIROUTE_BASE == llm.DEFAULT_OMNIROUTE_BASE, "cleared field falls back, never routes to ''"
llm.configure_omniroute("https://gw.example.com/v1/", "sk-test")
assert llm.OMNIROUTE_BASE == "https://gw.example.com/v1", "trailing slash would double up on /chat/completions"

# --- the auth header ----------------------------------------------------------------------------
llm._chat([{"role": "user", "content": "x"}], "auto")
assert sent["headers"]["Authorization"] == "Bearer sk-test"
assert sent["base"] == "https://gw.example.com/v1" and sent["path"] == "/chat/completions"

llm.configure_omniroute(None, None)
llm._chat([{"role": "user", "content": "x"}], "auto")
assert "Authorization" not in sent["headers"], "a keyless local gateway must not send an empty bearer"

# --- routing: OmniRoute is the fall-through, and the auto suffix must survive --------------------
for model in ("auto", "auto/chat:free", "auto/reasoning:free", "openai/gpt-4", "some-provider/model"):
    llm._chat([{"role": "user", "content": "x"}], model)
    assert sent["base"] == llm.DEFAULT_OMNIROUTE_BASE, f"{model} should route to OmniRoute"
    assert sent["body"]["model"] == model, f"{model} must reach the gateway verbatim - the :free tier suffix IS the filter"

llm.configure_litellm("http://localhost:4000", "sk-lite")
llm._chat([{"role": "user", "content": "x"}], "litellm/gpt-4o")
assert sent["base"] == "http://localhost:4000" and sent["body"]["model"] == "gpt-4o", "prefix is stripped for LiteLLM"

# Tools ride along on both OpenAI-compatible backends - the agent loop depends on it.
llm._omniroute_chat([], "auto", tools=[{"type": "function"}])
assert sent["body"]["tools"] == [{"type": "function"}]

# --- the model list -----------------------------------------------------------------------------
CATALOG = {"data": [{"id": "auto"}, {"id": "groq/llama-3.3-70b"}]}


def fake_urlopen(req, timeout=None):
    fake_urlopen.headers = dict(req.headers)
    return io.BytesIO(json.dumps(CATALOG).encode())


llm.configure_litellm(None, None)
llm.urllib.request.urlopen = fake_urlopen
ids = [m["id"] for m in llm.get_models()]
assert ids[0] == llm.DEFAULT_MODEL, "local Ollama stays first - it works with nothing running"
assert ids[1] == "auto/chat:free", "the free-tier auto route is the headline entry"
assert ids.count("auto") == 1, "an alias the catalog already advertises must not be listed twice"
assert "groq/llama-3.3-70b" in ids, "the gateway's own catalog still comes through"
for alias, _label in llm.AUTO_MODELS:
    assert alias in ids, f"{alias} missing from the picker"


def dead_urlopen(req, timeout=None):
    raise urllib.error.URLError("refused")


llm.urllib.request.urlopen = dead_urlopen
assert [m["id"] for m in llm.get_models()] == [llm.DEFAULT_MODEL], (
    "a gateway that is down contributes nothing rather than erroring - the list shows what is up"
)

print("ok - llm routing: base url, auth header, prefix routing, auto suffixes, model list")

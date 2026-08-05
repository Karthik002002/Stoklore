"""Compatibility shim. The server now lives in app/ - see app/main.py and app/routers/.

Kept so that `uvicorn api:app` (run.sh, the README, the docs) and `import api` keep working
unchanged. New code should import from `app.*` directly rather than through here.
"""
from app.main import app
from app.services.agent import AGENT_TOOL_IMPLS, REAL_TOOL_IMPLS, _guarded

__all__ = ["app", "AGENT_TOOL_IMPLS", "REAL_TOOL_IMPLS", "_guarded"]

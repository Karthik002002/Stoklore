from fastapi import APIRouter
from fastapi import HTTPException

from app.core import db
from app.core import llm
from app.core import rules

from app.schemas import WatchRuleRequest

router = APIRouter(tags=["watch-rules"])

@router.get("/api/watch-rules")
def watch_rules():
    return db.list_watch_rules()


@router.post("/api/watch-rules")
def create_watch_rule(req: WatchRuleRequest):
    name = req.name.strip()
    text = req.text.strip()
    if not name or not text:
        raise HTTPException(status_code=422, detail="name and rule text can't be empty")
    criteria = llm.parse_watch_rule(text, db.get_active_model())
    if not criteria:
        raise HTTPException(status_code=422, detail="couldn't recognize any criteria in that rule - "
                             "try mentioning P/E, an EMA crossover, or recent negative events")
    db.create_watch_rule(name, text, criteria.get("max_pe"), criteria.get("ema_short"),
                          criteria.get("ema_long"), criteria.get("no_negative_events_days"))
    return {"ok": True, "criteria": criteria}


@router.delete("/api/watch-rules/{rule_id}")
def delete_watch_rule(rule_id: int):
    db.delete_watch_rule(rule_id)
    return {"ok": True}


@router.get("/api/watch-rules/{rule_id}/check")
def check_watch_rule(rule_id: int, symbol: str | None = None):
    """A rule isn't tied to one stock - checks it against `symbol` if given, else against every
    watchlisted stock (a screener: which stocks currently meet this rule)."""
    rule = db.get_watch_rule_by_id(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="watch rule not found")
    if symbol:
        return {"symbol": symbol.upper(), **rules.evaluate(rule, symbol.upper())}
    return [{"symbol": s, **rules.evaluate(rule, s)} for s in db.watchlist_symbols()]

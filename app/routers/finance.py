"""Net worth + money goals (/finance). Plain storage - every number the page shows (net worth,
goal progress, required SIP, the Focus list) is computed in frontend/src/lib/goalMath.ts."""
from datetime import date

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.core import cas, db, fin_live
from app.services.quotes import paper_prices, paper_quotes
from app.schemas import FinGoalRequest, FinItemRequest, FinMonthlyUpdateRequest, FinSettingsRequest

router = APIRouter(tags=["finance"])


@router.get("/api/finance")
def finance_all():
    """Everything the page needs in one call - it is a few hundred rows at most."""
    return {
        "items": db.list_fin_items(),
        "snapshots": db.list_fin_snapshots(),
        "goals": db.list_fin_goals(),
        "cashflow": db.list_fin_cashflow(),
        "settings": db.get_fin_settings(),
    }


@router.post("/api/finance/items")
def create_item(req: FinItemRequest):
    return {"id": db.create_fin_item({**req.model_dump(), "name": req.name.strip()})}


@router.put("/api/finance/items/{item_id}")
def update_item(item_id: int, req: FinItemRequest):
    db.update_fin_item(item_id, {**req.model_dump(), "name": req.name.strip()})
    return {"ok": True}


@router.delete("/api/finance/items/{item_id}")
def delete_item(item_id: int):
    # Deleting drops the item's whole history (snapshots cascade) - archive keeps it on the net
    # worth curve. The UI says so before calling this.
    db.delete_fin_item(item_id)
    return {"ok": True}


@router.post("/api/finance/monthly-update")
def monthly_update(req: FinMonthlyUpdateRequest):
    known = {i["id"] for i in db.list_fin_items()}
    unknown = {s.item_id for s in req.snapshots} - known
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown item id(s): {sorted(unknown)}")
    db.upsert_fin_snapshots([(s.item_id, s.as_of, s.value) for s in req.snapshots])
    if req.cashflow:
        c = req.cashflow
        db.upsert_fin_cashflow(c.month.replace(day=1), c.income, c.expenses)
    return {"saved": len(req.snapshots)}


@router.delete("/api/finance/snapshots/{snapshot_id}")
def delete_snapshot(snapshot_id: int):
    db.delete_fin_snapshot(snapshot_id)
    return {"ok": True}


@router.delete("/api/finance/cashflow/{month}")
def delete_cashflow(month: date):
    db.delete_fin_cashflow(month)
    return {"ok": True}


def _goal_fields(req: FinGoalRequest):
    ids = [f.item_id for f in req.funding]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="an item can fund a goal only once")
    return {**req.model_dump(mode="json"), "name": req.name.strip(),
            "target_date": req.target_date}


@router.post("/api/finance/goals")
def create_goal(req: FinGoalRequest):
    return {"id": db.create_fin_goal(_goal_fields(req))}


@router.put("/api/finance/goals/{goal_id}")
def update_goal(goal_id: int, req: FinGoalRequest):
    db.update_fin_goal(goal_id, _goal_fields(req))
    return {"ok": True}


@router.delete("/api/finance/goals/{goal_id}")
def delete_goal(goal_id: int):
    db.delete_fin_goal(goal_id)
    return {"ok": True}


@router.put("/api/finance/settings")
def update_settings(req: FinSettingsRequest):
    db.set_fin_settings(req.model_dump())
    return {"ok": True}


MAX_CAS_BYTES = 20 * 1024 * 1024


@router.post("/api/finance/cas")
def import_cas(file: UploadFile = File(...), password: str = Form(...)):
    """Import a CAS PDF (CAMS / KFintech / NSDL / CDSL). Each holding becomes or updates a
    source='cas' item and gets a snapshot dated the statement's end. Neither the PDF nor the
    password (usually the PAN) is stored. Items an earlier CAS created but this one doesn't list
    are reported, not zeroed - a CAMS statement leaving out demat holdings is not a sale."""
    if (file.size or 0) > MAX_CAS_BYTES:
        raise HTTPException(status_code=413, detail="CAS PDF is larger than 20 MB")
    try:
        data = cas.read(file.file, password)
    except ImportError as e:
        raise HTTPException(status_code=500, detail="casparser is not installed (pip install -r requirements.txt)") from e
    except Exception as e:  # casparser raises its own CASParseError / IncorrectPasswordError family
        raise HTTPException(status_code=422, detail=f"Could not read the CAS: {e}") from e
    as_of, rows = cas.holdings(data)
    if as_of is None:
        raise HTTPException(status_code=422, detail="Could not find the statement period in this CAS")
    imported, snapshots = [], []
    for r in rows:
        existing = db.find_fin_item("cas", r["key"])
        item_id = existing["id"] if existing else db.create_fin_item(
            {"name": r["name"], "kind": r["kind"], "asset_class": r["asset_class"], "is_liquid": False,
             "interest_pct": None, "archived": False},
            source="cas", external_key=r["key"],
        )
        for p in r["positions"]:
            if not p["symbol"] and r["kind"] == "stock":
                p["symbol"] = fin_live.nse_symbol(p["isin"])
        db.set_fin_item_holdings(item_id, r["positions"] or None)
        snapshots.append((item_id, as_of, r["value"]))
        imported.append({"name": existing["name"] if existing else r["name"], "value": r["value"], "new": not existing})
    db.upsert_fin_snapshots(snapshots)
    seen = {r["key"] for r in rows}
    missing = [i["name"] for i in db.list_fin_items()
               if i["source"] == "cas" and not i["archived"] and i["external_key"] not in seen]
    return {"as_of": as_of, "file_type": data.get("file_type"), "imported": imported, "missing": missing,
            "warnings": [*(data.get("parse_warnings") or []), *cas.coverage_warnings(data, rows)]}


@router.get("/api/finance/live")
def finance_live(fresh: bool = False):
    """Today's value of every CAS item, from the units in its last statement - see fin_live.
    Read-only: the page shows it beside the statement value, nothing is written.
    fresh: the page's refresh button - fetch quotes now instead of serving the stored ones and
    refreshing them in the background (paper_quotes' default, right for the 60s poll)."""
    items = [i for i in db.list_fin_items() if i.get("holdings") and not i["archived"]]
    if not items:
        return {"items": {}}
    positions = [p for i in items for p in i["holdings"]]
    symbols = [p["symbol"] for p in positions if p.get("symbol")]
    if fresh:
        paper_prices(symbols)  # writes the store that paper_quotes reads back below
    quotes = paper_quotes(symbols)
    unquoted = any(not (quotes.get(p.get("symbol")) or {}).get("price") for p in positions)
    return {"items": fin_live.revalue(items, quotes, fin_live.amfi_navs() if unquoted else {})}


@router.post("/api/finance/link-trade-account/{account_id}")
def link_trade_account(account_id: int):
    """Track a journal account's wallet as a net-worth item. Its value isn't stored live - the
    monthly update pre-fills it from the account's current balance (lib/tradeAccounts.ts)."""
    account = next((a for a in db.list_trade_accounts(kind="journal") if a["id"] == account_id), None)
    if not account:
        raise HTTPException(status_code=404, detail="no such journal account")
    existing = db.find_fin_item("trade_account", str(account_id))
    if existing:
        return {"id": existing["id"]}
    return {"id": db.create_fin_item(
        {"name": f"{account['name']} (trading)", "kind": "stock", "asset_class": "equity", "is_liquid": False,
         "interest_pct": None, "archived": False},
        source="trade_account", external_key=str(account_id),
    )}

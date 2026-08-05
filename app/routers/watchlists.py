from fastapi import APIRouter
from fastapi import HTTPException

import db

from app.schemas import (
    RenameWatchlistRequest,
    ReorderWatchlistsRequest,
    WatchlistListRequest,
    WatchlistRequest,
)

router = APIRouter(tags=["watchlists"])

@router.get("/api/watchlist")
def watchlist():
    return db.list_watchlist()


@router.put("/api/watchlist/{symbol}")
def set_watchlist(symbol: str, req: WatchlistRequest):
    name = req.list_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="list_name can't be empty")
    db.set_watchlist(symbol.upper(), name)
    return {"ok": True}


@router.delete("/api/watchlist/{symbol}")
def remove_watchlist(symbol: str, list_name: str | None = None):
    """Removes from one list, or from every list (used when deleting the stock) when omitted."""
    db.remove_from_watchlist(symbol.upper(), list_name)
    return {"ok": True}


@router.get("/api/watchlists")
def watchlist_names():
    return db.list_watchlist_names()


@router.post("/api/watchlists")
def create_watchlist_list(req: WatchlistListRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name can't be empty")
    db.create_watchlist(name)
    return {"ok": True}


@router.post("/api/watchlists/reorder")
def reorder_watchlist_list(req: ReorderWatchlistsRequest):
    db.reorder_watchlists(req.names)
    return {"ok": True}


@router.put("/api/watchlists/{name}")
def rename_watchlist_list(name: str, req: RenameWatchlistRequest):
    new_name = req.new_name.strip()
    if not new_name:
        raise HTTPException(status_code=422, detail="new_name can't be empty")
    db.rename_watchlist(name, new_name)
    return {"ok": True}


@router.delete("/api/watchlists/{name}")
def delete_watchlist_list(name: str):
    if db.watchlist_symbols(name):
        raise HTTPException(status_code=400, detail=f"'{name}' still has stocks in it - move or remove them first")
    db.delete_watchlist(name)
    return {"ok": True}

"""Chart scans: a list of stocks flipped through one chart at a time in the chart modal (the
slideshow), each marked A/B/C as it goes by. A scan keeps its own copy of the list and where it
was left, so it resumes and stays a record after the watchlist it came from changes."""
import re

from fastapi import APIRouter, HTTPException

from app.core import db
from app.schemas import ScanMarkRequest, ScanRequest, ScanToWatchlistRequest, ScanUpdateRequest

router = APIRouter(tags=["scans"])

SYMBOL = re.compile(r"^[A-Z0-9&._-]{1,32}$")


def _scan(scan_id):
    scan = db.get_scan(scan_id)
    if not scan:
        raise HTTPException(404, f"No scan {scan_id}")
    return scan


@router.post("/api/scans")
def create_scan(req: ScanRequest):
    # one row per stock, in the order given; a symbol listed twice is scanned once
    symbols = list(dict.fromkeys(s.strip().upper() for s in req.symbols if s.strip()))
    bad = [s for s in symbols if not SYMBOL.match(s)]
    if bad or not symbols:
        raise HTTPException(422, f"Not a symbol: {', '.join(bad[:5])}" if bad else "No symbols to scan")
    return {**db.create_scan(req.name.strip(), req.source, symbols), "marks": []}


@router.get("/api/scans")
def list_scans():
    return db.list_scans()


@router.get("/api/scans/{scan_id}")
def get_scan(scan_id: int):
    return _scan(scan_id)


@router.patch("/api/scans/{scan_id}")
def update_scan(scan_id: int, req: ScanUpdateRequest):
    scan = _scan(scan_id)
    if req.position is not None and req.position >= len(scan["symbols"]):
        raise HTTPException(422, "position is past the end of the scan")
    db.update_scan(scan_id, req.position, req.finished)
    return _scan(scan_id)


@router.put("/api/scans/{scan_id}/marks/{symbol}")
def mark(scan_id: int, symbol: str, req: ScanMarkRequest):
    scan = _scan(scan_id)
    symbol = symbol.upper()
    if symbol not in scan["symbols"]:
        raise HTTPException(422, f"{symbol} isn't in this scan")
    return {"mark": db.set_scan_mark(scan_id, symbol, req.priority, (req.note or "").strip(), req.price)}


@router.post("/api/scans/{scan_id}/watchlist")
def to_watchlist(scan_id: int, req: ScanToWatchlistRequest):
    """The marked stocks of the chosen priorities into a watchlist (made if it doesn't exist)."""
    scan = _scan(scan_id)
    name = req.list_name.strip()
    symbols = [m["symbol"] for m in scan["marks"] if m["priority"] in req.priorities]
    if not symbols:
        raise HTTPException(422, f"Nothing marked {'/'.join(req.priorities)} in this scan")
    for s in symbols:
        db.set_watchlist(s, name)
    return {"list_name": name, "added": len(symbols)}


@router.delete("/api/scans/{scan_id}")
def delete_scan(scan_id: int):
    if not db.delete_scan(scan_id):
        raise HTTPException(404, f"No scan {scan_id}")
    return {"ok": True}

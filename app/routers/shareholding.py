from datetime import date, timedelta

from fastapi import APIRouter, HTTPException

from app.core import db
from app.core import shareholding
from app.services import jobs

router = APIRouter(tags=["shareholding"])

# Nothing here stores a verdict. Every change, pace and flag is derived from the filings on read -
# the same rule P&L and R:R follow elsewhere in this app, and it matters more here: a filing's XBRL
# detail can arrive days after the filing itself, and a stored verdict would still be saying
# "mechanism unknown" long after the data to answer it landed.

# Roughly two years of quarters, which is what the pace window needs to describe a move as gradual.
DEFAULT_HISTORY_DAYS = 760


@router.get("/api/shareholding")
def shareholding_screener(symbols: str | None = None, days: int = DEFAULT_HISTORY_DAYS, span: int = 4):
    """The screener table: one row per symbol, biggest recent promoter move first.

    `symbols` is a comma-separated filter (the frontend passes a watchlist); omitted means every
    company collected. `span` is how many filings the cumulative "gradual or a jump" window covers.
    """
    wanted = [s.strip().upper() for s in (symbols or "").split(",") if s.strip()] or None
    filings = db.list_shareholding_filings(symbols=wanted, since=date.today() - timedelta(days=days))
    return {
        "rows": shareholding.screener_rows(filings, span=span),
        "coverage": db.shareholding_coverage(),
        "verdicts": shareholding.VERDICTS,
    }


@router.get("/api/shareholding/status")
def shareholding_sync_status():
    return jobs.shareholding_status()


@router.post("/api/shareholding/sync")
def start_shareholding_sync(
    years: int = 1,
    detail: bool = True,
    from_date: str | None = None,
    to_date: str | None = None,
):
    """Collect (or re-collect) filings, either for the last `years` years or for an explicit
    from/to span (ISO dates - what the page's range picker sends).

    Safe to run over an existing table and over the daily job: filings are keyed on NSE's record
    id, so an overlapping window upserts rather than duplicates, and a filing whose XBRL detail is
    already stored is never fetched twice. Re-running a range you already have is therefore cheap
    and idempotent, which is what makes "just collect that quarter again" a reasonable thing to do.
    """
    start = end = None
    if from_date or to_date:
        if not (from_date and to_date):
            raise HTTPException(status_code=422, detail="both from_date and to_date are required")
        try:
            start, end = date.fromisoformat(from_date), date.fromisoformat(to_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="dates must be YYYY-MM-DD") from None
        if start > end:
            start, end = end, start
        if end > date.today():
            end = date.today()
        # The guard is on SPAN, not on how far back it reaches: collecting one old quarter is one
        # request, and refusing it would make the picker useless for exactly the case it exists for.
        if (end - start).days > 365 * shareholding.MAX_SEED_YEARS:
            raise HTTPException(
                status_code=422,
                detail=f"range must be {shareholding.MAX_SEED_YEARS} years or less",
            )
    elif not 1 <= years <= shareholding.MAX_SEED_YEARS:
        raise HTTPException(
            status_code=422, detail=f"years must be 1-{shareholding.MAX_SEED_YEARS}"
        )

    if not jobs.start_shareholding_sync(years=years, with_detail=detail, start=start, end=end):
        raise HTTPException(status_code=409, detail="a shareholding sync is already running")
    return {"ok": True, "windows": len(shareholding.windows_between(start, end)) if start else None}


# Registered after /status deliberately - FastAPI matches in order, and a parameterised sibling
# declared first would swallow the literal path (see app/routers/__init__.py).
@router.get("/api/shareholding/{symbol}")
def shareholding_for_symbol(symbol: str, span: int = 4):
    """One company's filing history, oldest first, with the change between each pair. This is what
    the stock page shows; the screener above is the same data collapsed to one row per symbol."""
    filings = db.list_shareholding_filings(symbols=[symbol.strip().upper()])
    if not filings:
        return {"symbol": symbol.upper(), "filings": [], "changes": [], "window": None}
    changes = shareholding.series_changes(filings)
    return {
        "symbol": symbol.upper(),
        "filings": shareholding.latest_per_period(filings),
        "changes": changes,
        "window": shareholding.pace(changes, span),
        "verdicts": shareholding.VERDICTS,
    }

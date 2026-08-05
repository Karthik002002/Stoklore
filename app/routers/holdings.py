from fastapi import APIRouter
from app.services.holdings import _get_holdings

router = APIRouter(tags=["holdings"])

@router.get("/api/holdings")
def holdings(broker_id: str | None = None, force: bool = False):
    return _get_holdings(broker_id, force)

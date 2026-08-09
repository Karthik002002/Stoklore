from fastapi import APIRouter
from fastapi import HTTPException

from app.core import db

from app.schemas import SentimentRequest
from app.services.scraping import _analyze_url

router = APIRouter(tags=["sentiment"])

@router.post("/api/sentiment")
def analyze_sentiment(req: SentimentRequest):
    try:
        return _analyze_url(req.url, req.model or db.get_active_model())
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

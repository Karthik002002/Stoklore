from fastapi import APIRouter
import json

from app.core import db
from app.core import scraper

from app.schemas import ScrapeRequest

router = APIRouter(tags=["system"])

@router.post("/api/cache/clear")
def clear_cache():
    db.clear_cache()
    return {"ok": True}


SCRAPE_OUTPUT_FILE = "local_data/scraped.json"


@router.post("/api/scrape")
def scrape_url(req: ScrapeRequest):
    """Scrapes an arbitrary URL's HTML (requests + BeautifulSoup, via scraper.scrape_article)
    and writes {url, title, text} to one JSON file, overwritten each call."""
    data = {"url": req.url, **scraper.scrape_article(req.url)}
    with open(SCRAPE_OUTPUT_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return data

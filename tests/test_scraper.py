import sys
from pathlib import Path

# Run as a script, so the repo root has to go on sys.path before importing app.* - the package
# is not installed, it just sits at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.scraper import scrape_article

if __name__ == "__main__":
    result = scrape_article("https://www.moneycontrol.com/news/business/markets/")
    assert result["title"] and result["text"], "scrape_article returned empty title/text"
    print(result["title"])
    print(result["text"][:500])

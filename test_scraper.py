from scraper import scrape_article

if __name__ == "__main__":
    result = scrape_article("https://www.moneycontrol.com/news/business/markets/")
    assert result["title"] and result["text"], "scrape_article returned empty title/text"
    print(result["title"])
    print(result["text"][:500])

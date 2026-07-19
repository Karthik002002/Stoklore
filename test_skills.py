"""Self-check for skill filtering, registry discovery, and Postgres storage/search."""
import skills
import db

TICKERS = [
    {"symbol": "AAA", "changePercent": 8.0, "volume": 1000, "avgVolume": 100},
    {"symbol": "BBB", "changePercent": 1.0, "volume": 1000, "avgVolume": 900},
]


def test_movement_skill():
    assert skills.load_skill("movement")(TICKERS) == [TICKERS[0]]


def test_volume_skill():
    assert skills.load_skill("volume")(TICKERS) == [TICKERS[0]]


def test_available_skills():
    assert {"movement", "volume"} <= set(skills.available_skills())


def test_db_roundtrip_and_search():
    db.init_schema()
    vec = [0.0] * 768
    vec[0] = 1.0
    db.insert_scraped_item("ZZZTEST", "## ZZZTEST\ntest report", vec)
    matches = db.similarity_search(vec, limit=1)
    assert matches[0]["symbol"] == "ZZZTEST"
    with db.connect() as conn:
        conn.execute("DELETE FROM scraped_items WHERE symbol = 'ZZZTEST'")


if __name__ == "__main__":
    test_movement_skill()
    test_volume_skill()
    test_available_skills()
    test_db_roundtrip_and_search()
    print("all checks passed")

"""Self-check for the screener.in HTML parser - the tricky bits are the '+' suffix screener puts
on expandable row labels, the summary <div> nested *inside* the announcement link, and concall
rows (a date label plus several links, unlike every other document group's one-link rows).
No network: parses a fixture cut down from a real company page."""
import sys
from pathlib import Path

# Run as a script, so the repo root has to go on sys.path before importing app.* - the package
# is not installed, it just sits at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import scraper

FIXTURE = """
<h1>Test Company Ltd</h1>
<ul id="top-ratios">
  <li><span class="name">Market Cap</span><span class="value">₹ 9,47,568 Cr.</span></li>
  <li><span class="name">ROCE</span><span class="value">6.09 %</span></li>
</ul>
<div class="pros"><ul><li>Healthy dividend payout of 20.0%</li></ul></div>
<div class="cons"><ul><li>Low interest coverage ratio.</li></ul></div>
<section id="quarters">
  <table>
    <tr><th></th><th>Mar 2025</th><th>Jun 2025</th></tr>
    <tr><td>Revenue&nbsp;+</td><td>119,509</td><td>117,996</td></tr>
    <tr><td>Financing Profit</td><td>-478</td><td>8,440</td></tr>
    <tr><td>Raw PDF</td><td></td><td></td></tr>
  </table>
</section>
<section id="documents">
  <div class="documents flex-column">
    <h3>Announcements</h3>
    <ul><li><a href="https://x.test/a.pdf">Change in Management
      <div class="ink-600 smaller">58m - New CFO from 1 August 2026.</div></a></li></ul>
  </div>
  <div class="documents concalls flex-column">
    <h3>Concalls</h3>
    <ul><li class="flex">
      <div class="ink-600">May 2026</div>
      <a class="concall-link" href="https://x.test/t.pdf">Transcript</a>
      <button type="button">AI Summary</button>
      <a class="concall-link" href="https://x.test/p.pdf">PPT</a>
    </li></ul>
  </div>
</section>
"""


def test_parses_fixture():
    data = scraper.parse_screener_html(FIXTURE, "https://example.test/")

    assert data["name"] == "Test Company Ltd"
    assert data["ratios"] == [
        {"label": "Market Cap", "value": "₹ 9,47,568 Cr."},
        {"label": "ROCE", "value": "6.09 %"},
    ]
    assert data["pros"] == ["Healthy dividend payout of 20.0%"]
    assert data["cons"] == ["Low interest coverage ratio."]

    quarters = data["tables"]["quarters"]
    assert quarters["periods"] == ["Mar 2025", "Jun 2025"]
    # '+' stripped off the expandable label; the trailing "Raw PDF" attachment row dropped.
    assert [r["label"] for r in quarters["rows"]] == ["Revenue", "Financing Profit"]
    assert quarters["rows"][1]["values"] == ["-478", "8,440"]

    announcements = data["documents"]["Announcements"]
    assert announcements == [{
        "title": "Change in Management",           # summary div not repeated in the title
        "detail": "58m - New CFO from 1 August 2026.",
        "url": "https://x.test/a.pdf",
    }]

    # One item per link, each prefixed with the row's quarter; the modal-only button is skipped.
    concalls = data["documents"]["Concalls"]
    assert [c["title"] for c in concalls] == ["May 2026 · Transcript", "May 2026 · PPT"]
    assert [c["url"] for c in concalls] == ["https://x.test/t.pdf", "https://x.test/p.pdf"]


# A screen page, cut down from a real one. Two things in it are traps: the header row repeats
# part-way down the table (screener does this on long screens), and one company has no NSE listing
# so its link carries a numeric BSE code instead of a ticker.
SCREEN_FIXTURE = """
<h1>Promoter Share Holding Finder</h1>
<textarea name="query">Unpledged promoter holding AND
Promoter holding >40</textarea>
<div>33 results found: Showing page 1 of 2</div>
<table class="data-table">
  <tr>
    <th class="text"><a href="?order=asc">S.No.</a></th>
    <th class="text"><a href="?sort=name">Company</a></th>
    <th data-tooltip="Current Price"><a href="#">CMP <span>Rs.</span></a></th>
    <th data-tooltip="Change in promoter holding"><a href="#">Change in Prom Hold <span>%</span></a></th>
  </tr>
  <tr data-row-company-id="1">
    <td class="text">1.</td>
    <td class="text"><a href="/company/538786/" target="_blank">Citizen Solar</a></td>
    <td>199.65</td><td>18.72</td>
  </tr>
  <tr>
    <th class="text"><a href="?order=asc">S.No.</a></th>
    <th class="text"><a href="?sort=name">Company</a></th>
    <th data-tooltip="Current Price"><a href="#">CMP</a></th>
    <th data-tooltip="Change in promoter holding"><a href="#">Change</a></th>
  </tr>
  <tr data-row-company-id="2">
    <td class="text">2.</td>
    <td class="text"><a href="/company/GABRIEL/consolidated/">Gabriel India</a></td>
    <td>1,300.50</td><td></td>
  </tr>
</table>
"""


def test_parses_screen_fixture():
    screen = scraper.parse_screen_html(SCREEN_FIXTURE, "https://www.screener.in/screens/1/x/")

    assert screen["name"] == "Promoter Share Holding Finder"
    assert screen["query"].startswith("Unpledged promoter holding AND")
    assert (screen["total"], screen["page"], screen["pages"]) == (33, 1, 2)
    # Keyed by the tooltip, which is what a template refers to - not by the abbreviated heading.
    assert [c["key"] for c in screen["columns"]] == ["current_price", "change_in_promoter_holding"]

    # The repeated header row is not a company.
    assert [r["name"] for r in screen["rows"]] == ["Citizen Solar", "Gabriel India"]

    citizen, gabriel = screen["rows"]
    # A numeric code is a BSE listing, kept out of `symbol` so no tool is handed "538786" as a ticker.
    assert (citizen["symbol"], citizen["bse_code"]) == (None, "538786")
    # /consolidated/ is a view of the same company, not part of its symbol.
    assert (gabriel["symbol"], gabriel["bse_code"]) == ("GABRIEL", None)
    # Numbers, thousands separator and all - so a condition node can compare them.
    assert citizen["current_price"] == 199.65 and gabriel["current_price"] == 1300.50
    assert gabriel["change_in_promoter_holding"] is None, "a blank cell is None, not 0"


# What screener.in actually serves once the anonymous allowance runs out: a 200 carrying its sign-up
# form, for the same URL that returned a results table minutes earlier.
REGISTER_WALL = """
<title>Register - Screener</title>
<h2>Get a free account</h2>
<form action="/register/" method="post">
  <input name="csrfmiddlewaretoken" value="x"><input name="next" value="/screens/86/quarterly-growers/">
  <input name="email"><input name="password">
</form>
"""


def test_screen_login_wall_is_named():
    # Not "no table, so private or deleted" - the screen is fine, screener wants a login.
    try:
        scraper.parse_screen_html(REGISTER_WALL, "https://www.screener.in/screens/86/quarterly-growers/")
    except scraper.ScreenLoginRequired as e:
        assert "login" in str(e)
    else:
        raise AssertionError("a register page must raise ScreenLoginRequired, not parse as nothing")
    # Still a ValueError, so the tool and the endpoint report it without their own except clause.
    assert issubclass(scraper.ScreenLoginRequired, ValueError)


def test_screen_page_without_table_is_none():
    assert scraper.parse_screen_html("<h1>Login</h1>", "https://www.screener.in/screens/1/x/") is None


def test_screen_url_is_canonical_and_guarded():
    # Whatever was pasted - query string, missing slash - one canonical page URL to paginate.
    for pasted in ("https://www.screener.in/screens/86/quarterly-growers/?limit=50&page=3",
                   "https://screener.in/screens/86/quarterly-growers",
                   "http://www.screener.in/screens/86/quarterly-growers/"):
        assert scraper.screen_url(pasted) == "https://www.screener.in/screens/86/quarterly-growers/", pasted

    # A server-side fetch of a pasted URL: everything that isn't a screener.in screen is refused.
    for bad in ("https://evil.test/screens/86/x/", "https://www.screener.in/company/TCS/",
                "https://screener.in.evil.test/screens/86/x/", "file:///etc/passwd",
                "http://localhost:8010/screens/1/x/", ""):
        try:
            scraper.screen_url(bad)
        except ValueError:
            continue
        raise AssertionError(f"should have refused {bad!r}")


def test_returns_none_without_company_heading():
    assert scraper.parse_screener_html("<p>404 not found</p>", "https://example.test/") is None


if __name__ == "__main__":
    test_parses_fixture()
    test_returns_none_without_company_heading()
    test_parses_screen_fixture()
    test_screen_login_wall_is_named()
    test_screen_page_without_table_is_none()
    test_screen_url_is_canonical_and_guarded()
    print("ok")

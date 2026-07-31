"""Self-check for the screener.in HTML parser - the tricky bits are the '+' suffix screener puts
on expandable row labels, the summary <div> nested *inside* the announcement link, and concall
rows (a date label plus several links, unlike every other document group's one-link rows).
No network: parses a fixture cut down from a real company page."""
import scraper

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


def test_returns_none_without_company_heading():
    assert scraper.parse_screener_html("<p>404 not found</p>", "https://example.test/") is None


if __name__ == "__main__":
    test_parses_fixture()
    test_returns_none_without_company_heading()
    print("ok")

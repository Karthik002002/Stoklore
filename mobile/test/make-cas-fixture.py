"""Writes test/fixtures/cas-sample.pdf: a made-up, password-protected (ABCDE1234F) consolidated account
statement with CDSL-, NSDL- and CAMS-style holding rows, for test/smoke.cjs and check.mjs's CAS parser.
Nobody's real data. Run: python3 test/make-cas-fixture.py (needs pypdf)."""
import io, os
from pypdf import PdfReader, PdfWriter

PAGES = [[
    "CONSOLIDATED ACCOUNT STATEMENT",
    "Statement for the period from 01-Oct-2026 to 31-Oct-2026",
    "CDSL Demat Account  DP Id: 12081600  Client Id: 00012345",
    "ISIN Security Current Bal Free Bal Lent Bal Market Price Value",
    "INE424C01010 GINNI FILAMENTS LIMITED - EQUITY SHARES 22.000 22.000 0.000 40.64 894.08",
    "INE467B01029 TATA CONSULTANCY SERVICES LTD 10.000 10.000 0.000 2,640.00 26,400.00",
    "INF204KB14I2 NIPPON INDIA ETF NIFTY 50 BEES 163.000 163.000 0.000 262.92 42,855.96",
    "INE000X01999 SOLD OUT COMPANY LTD 0.000 0.000 0.000 15.00 0.00",
], [
    "NSDL Demat Account",
    "ISIN Stock Symbol Company Name Face Value No. of Shares Market Price Value",
    "INE009A01021 INFY INFOSYS LIMITED 5.00 12 1,480.25 17,763.00",
    "Folio No: 12345678 / 01",
    "PPFAS Flexi Cap Fund - Direct Plan Growth - ISIN: INF879O01027 (Advisor: DIRECT) Registrar : CAMS",
    "Opening Unit Balance: 1,000.000",
    "Closing Unit Balance: 1,234.567 NAV on 31-Oct-2026: INR 85.4321 Total Cost Value: 90,000.00 Market Value on 31-Oct-2026: INR 1,05,471.33",
]]

def pdf(pages):
    objs, kids = [], []
    def add(body): objs.append(body); return len(objs)
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    pages_id = len(objs) + 1 + 2 * len(pages)
    for lines in pages:
        text = b"BT /F1 9 Tf 40 800 Td 12 TL " + b" ".join(b"(" + l.replace("(", r"\(").replace(")", r"\)").encode() + b") '" for l in lines) + b" ET"
        c = add(b"<< /Length %d >>\nstream\n" % len(text) + text + b"\nendstream")
        kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 842 842] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>" % (pages_id, c, font)))
    add(b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % k for k in kids) + b"] /Count %d >>" % len(kids))
    cat = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
    out, offs = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for i, o in enumerate(objs, 1):
        offs.append(out.tell()); out.write(b"%d 0 obj\n" % i + o + b"\nendobj\n")
    x = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs))
    out.write(b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, cat, x))
    return out.getvalue()

w = PdfWriter(clone_from=PdfReader(io.BytesIO(pdf(PAGES))))
w.encrypt(user_password="ABCDE1234F", owner_password="owner-not-used", algorithm="RC4-128")
path = os.path.join(os.path.dirname(__file__), "fixtures", "cas-sample.pdf")
with open(path, "wb") as f: w.write(f)
print("wrote", path, os.path.getsize(path), "bytes")

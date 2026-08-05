"""Constants shared by more than one router or service.

Anything here is imported by at least two modules; single-use constants stay next to their
endpoint. Pulling these out is what keeps routers and services from importing each other.
"""
from zoneinfo import ZoneInfo

# The exchange's calendar, used wherever a timestamp has to be reduced to "which trading day was
# this" - price_history is keyed by plain date, so anything matching a timestamptz against it has
# to pick a timezone explicitly rather than let the server's locale decide.
IST = ZoneInfo("Asia/Kolkata")

# Manual-trade screenshot uploads - local disk only, matches the app's "nothing leaves your
# machine" design. Served straight back out at /uploads/<filename>.
UPLOAD_DIR = "uploads"

DIRECTIONS = {"long", "short"}
RESULTS = {"profit", "loss", "neutral"}
SUPPORTED_BROKERS = {"dhan", "kite"}

"""netfetch._throttle is per host: a queue of sleeps on one host must not delay another host.

Run: python tests/netfetch_throttle.selfcheck.py"""
import threading
import time

from app.core import netfetch

netfetch.MIN_INTERVAL = 1.0
netfetch.JITTER = 0

# Three back-to-back calls to a busy host: the 2nd and 3rd each sleep ~1s holding that host's lock.
busy = [threading.Thread(target=netfetch._throttle, args=("https://nseindia.com/api/x",)) for _ in range(3)]
for t in busy:
    t.start()
time.sleep(0.1)  # let the busy host's queue form

t0 = time.monotonic()
netfetch._throttle("https://www.moneycontrol.com/autosuggest")
other = time.monotonic() - t0

# Same host still spaces out: a second call right after must wait out MIN_INTERVAL.
t0 = time.monotonic()
netfetch._throttle("https://www.moneycontrol.com/autosuggest")
same = time.monotonic() - t0
for t in busy:
    t.join()

assert other < 0.2, f"other host waited {other:.2f}s behind nseindia.com's throttle"
assert same > 0.8, f"same host only waited {same:.2f}s"

print(f"PASSED: other host {other:.3f}s, same host {same:.2f}s")

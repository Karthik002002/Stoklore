class SourceError(Exception):
    """Raised by any price source's fetch_max() on a network/parsing failure - a single common
    type so callers can catch and isolate one plugin's failure (rate-limited, banned, endpoint
    changed shape, ...) without it affecting any other plugin or any other symbol's collection."""

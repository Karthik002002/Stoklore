"""Financial sentiment scoring via a local Hugging Face model - no API keys, no network calls."""
from functools import lru_cache

MODEL_ID = "soleimanian/financial-roberta-large-sentiment"


@lru_cache(maxsize=1)
def _pipeline():
    # ponytail: loaded lazily on first use (not at import time) - the model is ~1.4GB and this
    # module is imported by api.py on every startup, most of which never touch sentiment analysis.
    from transformers import pipeline
    return pipeline("text-classification", model=MODEL_ID, top_k=None)


def analyze(text):
    """Returns {label, score} for the dominant sentiment class (positive/negative/neutral)."""
    scores = _pipeline()(text[:2000], truncation=True)[0]
    top = max(scores, key=lambda s: s["score"])
    return {"label": top["label"], "score": round(top["score"], 4)}

"""Speech to text with Whisper, locally - nothing recorded here ever leaves the machine.

Runs on the `transformers` + `torch` already installed for the sentiment model, so voice capture
adds no new dependency. The browser sends 16 kHz mono WAV (see frontend/src/lib/voice.ts), which is
read with the standard library's `wave` module: the transformers pipeline can accept encoded audio
(mp3/webm) too, but only by shelling out to ffmpeg, which isn't installed here and isn't worth
requiring for something the browser can do itself.
"""
import io
import wave
from functools import lru_cache

import numpy as np

# Whisper's English-only base model: ~150MB, a few hundred ms for a short phrase on Apple silicon.
# The multilingual/large variants are several GB for accuracy that dictation of NSE tickers and
# short commands doesn't need.
MODEL_ID = "openai/whisper-base.en"
SAMPLE_RATE = 16000
#: Longer than this is a stuck key, not a sentence - and Whisper's window is 30s anyway.
MAX_SECONDS = 60


@lru_cache(maxsize=1)
def _pipeline():
    # ponytail: lazy, like sentiment.py and classifier.py - the model is only downloaded and loaded
    # the first time someone actually holds the voice key.
    import torch
    from transformers import pipeline

    device = "mps" if torch.backends.mps.is_available() else ("cuda:0" if torch.cuda.is_available() else "cpu")
    return pipeline("automatic-speech-recognition", model=MODEL_ID, device=device)


def loaded():
    return _pipeline.cache_info().currsize > 0


def read_wav(data):
    """WAV bytes -> mono float32 in [-1, 1] at SAMPLE_RATE. Raises ValueError on anything this
    can't read, so the endpoint can answer 422 rather than 500."""
    try:
        with wave.open(io.BytesIO(data)) as wav:
            channels, width, rate, frames = (
                wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
            )
            raw = wav.readframes(frames)
    except wave.Error as e:
        raise ValueError(f"not a WAV file: {e}") from e
    if width != 2:
        raise ValueError("expected 16-bit PCM WAV")
    if rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE}Hz audio, got {rate}Hz")
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:  # the recorder sends mono, but a downmix is two lines and saves a 422
        audio = audio.reshape(-1, channels).mean(axis=1)
    if len(audio) > MAX_SECONDS * SAMPLE_RATE:
        raise ValueError(f"recording is longer than {MAX_SECONDS}s")
    return audio


#: Below this RMS the clip is room noise. Whisper hallucinates on silence - a muted mic reliably
#: transcribes as "you" or "Thank you." - so quiet audio is never sent to the model at all.
SILENCE_RMS = 0.005


def is_silent(audio):
    return float(np.sqrt(np.mean(np.square(audio)))) < SILENCE_RMS if len(audio) else True


def transcribe(data):
    """WAV bytes -> the text that was said. Empty string when nothing was."""
    audio = read_wav(data)
    if len(audio) < SAMPLE_RATE // 10 or is_silent(audio):  # a tapped key, or a muted mic
        return ""
    result = _pipeline()({"raw": audio, "sampling_rate": SAMPLE_RATE})
    return (result.get("text") or "").strip()

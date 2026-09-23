"""Self-check for app/core/speech.py - WAV parsing and the gates, with the model stubbed:

    .venv/bin/python tests/speech.selfcheck.py

The model itself isn't exercised here (it's a download and a GPU): what is pinned is that bad audio
is rejected with a reason, and that silence never reaches Whisper - a muted mic transcribes as
"you" or "Thank you", which would then be sent to the chat agent as if it had been said.
"""
import io
import sys
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import speech  # noqa: E402


def wav_bytes(signal, rate=speech.SAMPLE_RATE, channels=1, width=2):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes((np.clip(signal, -1, 1) * 32767).astype(np.int16).tobytes())
    return buf.getvalue()


def tone(seconds=1.0, amplitude=0.3, rate=speech.SAMPLE_RATE):
    t = np.linspace(0, seconds, int(rate * seconds), endpoint=False)
    return amplitude * np.sin(2 * np.pi * 220 * t)


# read_wav: shape and range.
audio = speech.read_wav(wav_bytes(tone()))
assert audio.dtype == np.float32 and len(audio) == speech.SAMPLE_RATE
assert abs(audio).max() <= 1.0

# Stereo is downmixed rather than refused.
stereo = np.repeat(tone(0.5)[:, None], 2, axis=1).ravel()
assert len(speech.read_wav(wav_bytes(stereo, channels=2))) == speech.SAMPLE_RATE // 2


def refused(data):
    try:
        speech.read_wav(data)
    except ValueError as e:
        return str(e)
    raise AssertionError("expected a ValueError")


assert "not a WAV" in refused(b"this is not audio")
assert "8000Hz" in refused(wav_bytes(tone(), rate=8000))  # the browser resamples; a mismatch is a bug
assert "16-bit" in refused(wav_bytes(tone(), width=1))
assert "longer than" in refused(wav_bytes(tone(seconds=speech.MAX_SECONDS + 1)))

# The silence gate: a muted mic and room noise never reach the model.
assert speech.is_silent(np.zeros(speech.SAMPLE_RATE))
assert speech.is_silent(np.random.normal(0, 0.002, speech.SAMPLE_RATE).astype(np.float32))
assert not speech.is_silent(tone())
assert speech.is_silent(np.array([]))

calls = []
speech._pipeline = lambda: (lambda payload: calls.append(payload) or {"text": "  hello there  "})

assert speech.transcribe(wav_bytes(np.zeros(speech.SAMPLE_RATE))) == ""  # silence
assert speech.transcribe(wav_bytes(tone(seconds=0.05))) == ""  # a tapped key
assert calls == [], "silence was sent to Whisper"

assert speech.transcribe(wav_bytes(tone())) == "hello there"  # trimmed
assert len(calls) == 1 and calls[0]["sampling_rate"] == speech.SAMPLE_RATE

speech._pipeline = lambda: (lambda payload: {"text": None})
assert speech.transcribe(wav_bytes(tone())) == ""

print("ok - speech: wav parsing, stereo downmix, refusals, silence gate, trimming")

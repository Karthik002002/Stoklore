# Voice Capture

[← Back to index](README.md)

Hold a key, say something, let go. The audio is transcribed on your own machine by Whisper and
then either typed into the field you were in, used to navigate, or sent to the chat agent — which
has the tools to actually do things.

Nothing leaves the machine: the recording is posted to this app's own backend, transcribed
locally, and never written to disk.

## Using it

**Hold ⌘⇧V** (Ctrl+Shift+V on Windows/Linux), speak, release. Rebind or switch it off in
**Settings › Shortcuts → Voice capture**, like any other shortcut.

While recording, a pill appears at the bottom of the window ("Listening…", then "Transcribing…").
Releasing any of the keys ends the take, and switching away from the window cancels it — the mic
is released either way.

What happens to what you said depends on where you were:

| Where you were | What happens |
|---|---|
| In a text box (notes, a watch rule, the chat input) | It's typed in at the cursor. **Nothing is executed**, whatever the words were |
| Anywhere else, saying a place | It navigates: "open bar replay", "go to holdings", "show me settings trade accounts", "open the journal" |
| Anywhere else, saying anything else | It goes to the chat agent as a message: "what are today's top gainers", "scan my watchlist for events" |

The agent is what makes this useful — it already has 17 tools, so asking out loud for prices,
movers, an event scan, a screen or a watch-rule check does the work rather than just answering.

**Navigation is deliberately strict.** A phrase navigates only if it starts with a verb like open
/ go to / show me *and* names a real destination, or if it is exactly a destination's name
("alerts"). Anything else falls through to the agent: "top news" navigates, "top news on TCS
today" is a question. Getting sent to the wrong page mid-thought is worse than the agent asking
what you meant.

Spoken names that the UI doesn't use are mapped: "the journal" → Backtesting › Trades,
"portfolio" → Holdings, "replay" → Bar Replay, "stats" → Backtesting › Statistics.

## How it works

- **Recording** (`frontend/src/lib/voice.ts`) uses `MediaRecorder`, then decodes and resamples in
  the browser to **16 kHz mono 16-bit WAV**. The backend reads that with the standard library's
  `wave` module. The transformers pipeline could take webm/mp3 directly, but only by shelling out
  to `ffmpeg`, which isn't installed here — and the browser already has a decoder and a resampler.
- **Transcription** (`app/core/speech.py`) is `openai/whisper-base.en` through the `transformers`
  and `torch` already installed for the sentiment model, so voice added **no new dependency**. The
  model is ~150 MB, downloaded from Hugging Face on first use and then held in memory: the first
  capture after a restart takes a few seconds, after which a short phrase is ~250 ms on Apple
  silicon (MPS).
- **Silence never reaches Whisper.** A muted or quiet mic reliably transcribes as "you" or "Thank
  you." — which would then be sent to the agent as if you'd said it. Anything under an RMS of
  0.005 (or shorter than 100 ms) returns an empty transcript instead (`speech.is_silent`).
- **Routing** (`frontend/src/lib/voiceCommands.ts`) is pure and self-checked. Destinations come
  from `frontend/src/lib/navTargets.ts`, the same tables the command palette renders, so a new
  page is reachable by voice and by ⌘K without being listed twice.
- **Hold-to-talk** needs both keydown and keyup, which `useShortcut`/`useHotkey` can't express
  (they fire on keydown only), so `VoiceCapture.tsx` uses window listeners that read the same
  binding every other shortcut uses. Releasing a *modifier* also stops the take: on macOS, letting
  go of ⌘ first means the letter's keyup never arrives.
- **Dictation into React fields** goes through the native value setter plus an `input` event —
  assigning `.value` alone leaves a controlled input's state stale. The chat input is a Lexical
  contenteditable, which takes `insertText` instead.
- The field that had focus **when the key went down** is where dictation lands, not whatever has
  focus when you let go.

## Limits worth knowing

- **English only.** `whisper-base.en` is the English model; the multilingual ones are several GB.
- **Accuracy is base-model accuracy.** Everyday phrases and NSE tickers are fine; unusual symbols
  may need correcting. For dictation, that's a typo; for the agent, it's a question you re-ask.
- **The mic needs a secure context** — `localhost` counts, so the dev server is fine.
- **Voice can't confirm a gated action.** `scrape_stock` still needs the Confirm button in chat,
  by design.

## Checks

```bash
.venv/bin/python tests/speech.selfcheck.py     # WAV parsing, refusals, the silence gate
node frontend/src/lib/voice.selfcheck.mjs      # the WAV the browser produces
node frontend/src/lib/voiceCommands.selfcheck.mjs  # what a phrase does, and every nav target
```

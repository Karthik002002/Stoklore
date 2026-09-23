// Microphone capture, in the shape the backend wants: 16 kHz mono 16-bit WAV.
//
// The browser records whatever its MediaRecorder prefers (webm/opus on Chrome), then decodes and
// resamples it here. That is deliberate: the transformers pipeline can read encoded audio only by
// shelling out to ffmpeg, which isn't installed - and the browser already has a decoder and a
// resampler. Nothing is uploaded anywhere except this app's own /api/voice/transcribe.

export const TARGET_RATE = 16000

/** PCM float samples -> a WAV file's bytes. Pure (no DOM), so voice.selfcheck.mjs can read the
 *  header back. 16-bit little-endian, mono, which is what app/core/speech.py accepts. */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // PCM, uncompressed
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    // Clamped before scaling: a sample over 1.0 would otherwise wrap to the opposite sign and
    // turn a loud word into a burst of noise.
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

/** Decode whatever the recorder produced, downmix to mono and resample to 16 kHz. */
async function toMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer()
  const decodeCtx = new AudioContext()
  try {
    const decoded = await decodeCtx.decodeAudioData(bytes)
    const frames = Math.ceil((decoded.duration * TARGET_RATE) / 1) || 1
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return rendered.getChannelData(0).slice()
  } finally {
    decodeCtx.close()
  }
}

export type Recorder = {
  /** Stops, releases the mic, and resolves with the WAV to upload. */
  stop: () => Promise<Blob>
  /** Stops and releases the mic, throwing the audio away. */
  cancel: () => void
}

/** Starts recording. Throws if the user denies the mic or the browser has none. */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  recorder.start()
  const release = () => stream.getTracks().forEach((t) => t.stop())

  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onstop = async () => {
          release()
          try {
            const samples = await toMono16k(new Blob(chunks, { type: recorder.mimeType }))
            resolve(new Blob([encodeWav(samples)], { type: 'audio/wav' }))
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)))
          }
        }
        recorder.stop()
      }),
    cancel: () => {
      try {
        recorder.stop()
      } finally {
        release()
      }
    },
  }
}

/** Sends a WAV to the local Whisper model and returns what it heard. */
export async function transcribe(wav: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', wav, 'capture.wav')
  const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail ?? `transcription failed (${res.status})`)
  }
  return (await res.json()).text as string
}

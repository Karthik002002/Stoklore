// Self-check for the WAV encoder the mic path produces. Plain node:
//   node src/lib/voice.selfcheck.mjs
// The recording itself needs a browser; what is pinned here is the file format, because a header
// the backend rejects would only show up as a 422 after you'd spoken.
import assert from 'node:assert/strict'
import { encodeWav, TARGET_RATE } from './voice.ts'

const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2])
const view = new DataView(encodeWav(samples))
const ascii = (o, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)))

assert.equal(ascii(0, 4), 'RIFF')
assert.equal(ascii(8, 4), 'WAVE')
assert.equal(ascii(12, 4), 'fmt ')
assert.equal(ascii(36, 4), 'data')
assert.equal(view.getUint16(20, true), 1, 'PCM')
assert.equal(view.getUint16(22, true), 1, "mono - speech.py downmixes but shouldn't have to")
assert.equal(view.getUint32(24, true), TARGET_RATE, 'speech.py refuses any other rate')
assert.equal(view.getUint16(34, true), 16, '16-bit')
assert.equal(view.getUint32(40, true), samples.length * 2, 'data size')
assert.equal(view.byteLength, 44 + samples.length * 2)
assert.equal(view.getUint32(4, true), 36 + samples.length * 2, 'RIFF size')

const pcm = (i) => view.getInt16(44 + i * 2, true)
assert.equal(pcm(0), 0)
assert.equal(pcm(1), Math.trunc(0.5 * 0x7fff)) // setInt16 truncates toward zero
assert.equal(pcm(2), -0x4000)
assert.equal(pcm(3), 0x7fff)
assert.equal(pcm(4), -0x8000)
// Out-of-range samples clamp instead of wrapping to the opposite sign.
assert.equal(pcm(5), 0x7fff)
assert.equal(pcm(6), -0x8000)

assert.equal(encodeWav(new Float32Array(), 8000).byteLength, 44)
assert.equal(new DataView(encodeWav(new Float32Array(), 8000)).getUint32(24, true), 8000)

console.log('ok - voice: WAV header, mono 16k 16-bit, clamping')

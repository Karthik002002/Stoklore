// Self-check for the shortcut registry's pure half. Plain node, no framework:
//   node src/lib/shortcuts.selfcheck.mjs
//
// The hooks and the zustand store are not exercised here (they need React and a DOM); everything
// they depend on - key parsing, formatting, conflict detection, default fallback - is.
import assert from 'node:assert/strict'
import {
  SHORTCUTS,
  bindingFor,
  conflictingIds,
  defaultFor,
  formatShortcut,
  keyFromEvent,
} from './shortcuts.ts'

// --- the registry itself ------------------------------------------------------------------------
// Ids are storage keys; a duplicate would make two actions fight over one saved binding.
const ids = SHORTCUTS.map((s) => s.id)
assert.equal(new Set(ids).size, ids.length, 'shortcut ids must be unique')
// Shipping a default that already clashes would mean one of the two never fires out of the box.
assert.deepEqual([...conflictingIds({})], [], 'the shipped defaults must not collide')
for (const s of SHORTCUTS) assert.ok(s.label && s.scope && s.default, `incomplete entry: ${s.id}`)

// --- binding lookup -----------------------------------------------------------------------------
assert.equal(bindingFor({}, 'replay.buy'), 'b', 'untouched falls back to the default')
assert.equal(bindingFor({ 'replay.buy': 'q' }, 'replay.buy'), 'q')
// '' is a real value - "off" - and must NOT fall back to the default, or a shortcut turned off
// would come straight back.
assert.equal(bindingFor({ 'replay.buy': '' }, 'replay.buy'), '')
assert.equal(bindingFor({}, 'nope.missing'), '')
assert.equal(defaultFor('replay.buy'), 'b')

// --- key capture --------------------------------------------------------------------------------
const ev = (key, mods = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})
assert.equal(keyFromEvent(ev('b')), 'b')
assert.equal(keyFromEvent(ev('B', { shiftKey: true })), 'shift+b', 'the letter is lowercased')
assert.equal(keyFromEvent(ev('k', { metaKey: true })), 'Mod+k')
assert.equal(keyFromEvent(ev('k', { ctrlKey: true })), 'Mod+k', 'Ctrl and Cmd are both Mod')
assert.equal(keyFromEvent(ev('ArrowDown', { shiftKey: true })), 'shift+down')
assert.equal(keyFromEvent(ev('/')), '/')
assert.equal(keyFromEvent(ev('r', { metaKey: true, altKey: true, shiftKey: true })), 'Mod+alt+shift+r')

// A modifier on its own is not a shortcut yet - the capture field has to keep waiting rather than
// record "shift" and close.
assert.equal(keyFromEvent(ev('Shift', { shiftKey: true })), null)
assert.equal(keyFromEvent(ev('Meta', { metaKey: true })), null)
// Anything unnamed and longer than one character (F13, Dead keys, IME junk) is refused rather than
// stored as a binding that can never match.
assert.equal(keyFromEvent(ev('Unidentified')), null)

// --- display ------------------------------------------------------------------------------------
assert.equal(formatShortcut('shift+b', true), '⇧ B')
assert.equal(formatShortcut('Mod+K', true), '⌘ K')
assert.equal(formatShortcut('Mod+K', false), 'Ctrl K')
assert.equal(formatShortcut('shift+down', true), '⇧ ↓')
assert.equal(formatShortcut('/', true), '/')
assert.equal(formatShortcut('', true), 'Off', 'an unbound action reads as off, not as an empty gap')

// --- conflicts ----------------------------------------------------------------------------------
const clash = conflictingIds({ 'replay.buy': 't' })
assert.deepEqual([...clash].sort(), ['replay.buy', 'replay.timeframe'], 'both sides are flagged')
assert.deepEqual([...conflictingIds({ 'replay.buy': 'q' })], [], 'a free key is not a conflict')
// Any number of shortcuts can be off at once.
assert.deepEqual([...conflictingIds({ 'replay.buy': '', 'replay.sell': '' })], [])
// A rebind that vacates a key clears the conflict on the OTHER side too.
assert.deepEqual([...conflictingIds({ 'replay.buy': 't', 'replay.timeframe': 'y' })], [])

console.log('ok - shortcuts: registry, binding fallback, key capture, formatting, conflicts')

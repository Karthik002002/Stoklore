// Every keyboard shortcut in the app, in one place, rebindable from Settings › Shortcuts.
//
// Two things live here: the REGISTRY (what actions exist and what they're bound to by default) and
// the STORE (what this browser has rebound them to). Components never write a key string any more -
// they call useShortcut('replay.buy', fn) and the binding is looked up, so the Settings tab and the
// tooltips in Bar Replay's bottom bar can never disagree with what actually fires.
//
// Bindings are per-BROWSER (localStorage via zustand persist), not per-account in Postgres. A
// keyboard layout is a property of the machine you're sitting at, and the shortcut you press on the
// laptop shouldn't be forced onto the desktop. Nothing here needs the server.
//
// Key strings are @tanstack/react-hotkeys' own format ('shift+b', 'Mod+K', '/'), so a binding can
// be handed straight to useHotkey. Pure helpers below are checked by shortcuts.selfcheck.mjs.
import { useHotkey } from '@tanstack/react-hotkeys'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** The registry. `id` is a stable storage key - renaming a label is free, renaming an id resets
 *  whatever the user had bound. `scope` is only a display grouping; every binding is checked for
 *  conflicts against every other one, because the replay page has the global shortcuts live too. */
export const SHORTCUTS = [
  { id: 'global.commandPalette', scope: 'Global', label: 'Command palette', default: 'Mod+K' },
  { id: 'global.chat', scope: 'Global', label: 'Toggle AI chat', default: 'Mod+/' },

  { id: 'replay.buy', scope: 'Bar Replay', label: 'Buy — open order ticket', default: 'b' },
  { id: 'replay.sell', scope: 'Bar Replay', label: 'Sell — open order ticket', default: 's' },
  {
    id: 'replay.buyMarket',
    scope: 'Bar Replay',
    label: 'Buy at market (skips the ticket)',
    default: 'shift+b',
  },
  {
    id: 'replay.sellMarket',
    scope: 'Bar Replay',
    label: 'Sell at market (skips the ticket)',
    default: 'shift+s',
  },
  { id: 'replay.symbol', scope: 'Bar Replay', label: 'Change symbol', default: '/' },
  { id: 'replay.timeframe', scope: 'Bar Replay', label: 'Change timeframe', default: 't' },
  { id: 'replay.playPause', scope: 'Bar Replay', label: 'Play / pause', default: 'shift+down' },
  { id: 'replay.step', scope: 'Bar Replay', label: 'Step one bar forward', default: 'shift+right' },
  { id: 'replay.randomBar', scope: 'Bar Replay', label: 'Jump to a random bar', default: 'shift+r' },
  { id: 'replay.strategy', scope: 'Bar Replay', label: "Show the account's strategy", default: 'a' },
]

export const SHORTCUT_SCOPES = [...new Set(SHORTCUTS.map((s) => s.scope))]

const DEFAULTS = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.default]))

/** The binding in force for `id`: what the user set, or the default when they haven't touched it.
 *  An EMPTY STRING is a real, deliberate value - "this shortcut is off" - and is why unset can't
 *  simply be represented by a missing/blank binding. */
export function bindingFor(bindings, id) {
  return bindings[id] ?? DEFAULTS[id] ?? ''
}

export const defaultFor = (id) => DEFAULTS[id] ?? ''

// Modifier keys pressed alone are not shortcuts - a capture field must keep listening rather than
// recording "shift".
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])

// KeyboardEvent.key -> the name react-hotkeys uses.
const KEY_NAMES = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ' ': 'space',
  Escape: 'escape',
  Enter: 'enter',
  Backspace: 'backspace',
  Delete: 'delete',
  Tab: 'tab',
}

/** A KeyboardEvent -> a binding string, or null when the event isn't one yet (a lone modifier).
 *
 *  Ctrl and Cmd both become 'Mod', which is how the hotkey library spells "the platform's command
 *  modifier" - binding a literal Ctrl on a Mac would be a shortcut the user can't comfortably press
 *  and doesn't match the ⌘ printed everywhere else in the UI. */
export function keyFromEvent(event) {
  if (MODIFIER_KEYS.has(event.key)) return null
  const parts = []
  if (event.metaKey || event.ctrlKey) parts.push('Mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  const name = KEY_NAMES[event.key] ?? (event.key.length === 1 ? event.key.toLowerCase() : null)
  if (!name) return null
  parts.push(name)
  return parts.join('+')
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')

const SYMBOLS = { shift: '⇧', alt: '⌥', up: '↑', down: '↓', left: '←', right: '→' }

/** A binding as a person reads it: 'shift+b' -> '⇧ B', 'Mod+K' -> '⌘ K' (or 'Ctrl K'). */
export function formatShortcut(key, mac = isMac()) {
  if (!key) return 'Off'
  return key
    .split('+')
    .map((part) => {
      if (part === 'Mod') return mac ? '⌘' : 'Ctrl'
      return SYMBOLS[part] ?? (part.length === 1 ? part.toUpperCase() : part)
    })
    .join(' ')
}

/** Ids sharing a binding with something else, as a Set. Two shortcuts on one key means one of them
 *  silently never fires, so this is surfaced in the Settings tab rather than left to be discovered
 *  mid-session. Disabled ('') bindings never conflict - any number of them can be off. */
export function conflictingIds(bindings) {
  const byKey = new Map()
  for (const { id } of SHORTCUTS) {
    const key = bindingFor(bindings, id)
    if (!key) continue
    byKey.set(key, [...(byKey.get(key) ?? []), id])
  }
  const clashing = new Set()
  for (const ids of byKey.values()) {
    if (ids.length > 1) for (const id of ids) clashing.add(id)
  }
  return clashing
}

// --- store --------------------------------------------------------------------------------------
// Only OVERRIDES are stored, never the whole map: a default that changes in a later version then
// reaches everyone who hadn't deliberately rebound that action, instead of being frozen into every
// browser's localStorage the first time the tab was opened.

export const useShortcutStore = create(
  persist(
    (set) => ({
      bindings: {},
      setBinding: (id, key) => set((s) => ({ bindings: { ...s.bindings, [id]: key } })),
      resetBinding: (id) =>
        set((s) => {
          const { [id]: _dropped, ...rest } = s.bindings
          return { bindings: rest }
        }),
      resetAll: () => set({ bindings: {} }),
    }),
    { name: 'shortcuts', version: 1 },
  ),
)

/** Register a shortcut by id instead of by key. Same options as useHotkey (`enabled`, etc).
 *
 *  A binding of '' is off: the hotkey is registered against a key nobody has (so the hook's own
 *  rules about hook order still hold) and disabled outright. */
export function useShortcut(id, handler, options) {
  const key = useShortcutStore((s) => bindingFor(s.bindings, id))
  useHotkey(key || 'f24', handler, { ...options, enabled: !!key && (options?.enabled ?? true) })
}

/** The display string for a shortcut, reactive to rebinding - for tooltips and hint labels. */
export function useShortcutLabel(id) {
  return formatShortcut(useShortcutStore((s) => bindingFor(s.bindings, id)))
}

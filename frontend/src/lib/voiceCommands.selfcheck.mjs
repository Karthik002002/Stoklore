// Self-check for what a spoken phrase does. Plain node, no test framework:
//   node src/lib/voiceCommands.selfcheck.mjs
import assert from 'node:assert/strict'
import { NAV_TARGETS } from './navTargets.ts'
import { matchNavTarget, normalize, routeTranscript, scoreTarget } from './voiceCommands.ts'

const route = (text, opts) => routeTranscript(text, opts)
const where = (text) => {
  const r = route(text)
  return r.kind === 'navigate' ? `${r.target.to}${r.target.search ? ` ${JSON.stringify(r.target.search)}` : ''}` : r.kind
}

assert.equal(normalize('  Open Bar Replay. '), 'open bar replay')
assert.equal(scoreTarget('bar replay', 'Bar Replay'), 1)

// A navigation verb plus a place this app has.
assert.equal(where('Open bar replay.'), '/backtest/replay')
assert.equal(where('go to holdings'), '/holdings')
assert.equal(where('show me top news'), '/top-news')
assert.equal(where('take me to settings trade accounts'), '/settings {"tab":"accounts"}')
assert.equal(where('open backtesting statistics'), '/backtesting {"view":"statistics"}')
// Spoken names the UI doesn't use.
assert.equal(where('open the journal'), '/backtesting {"view":"trades"}')
assert.equal(where('go to my portfolio page'), '/holdings')

// The exact name of a page navigates without a verb...
assert.equal(where('alerts'), '/alerts')
// ...but anything more is a question, not a destination.
assert.equal(where('top news on TCS today'), 'chat')
assert.equal(where('what are the top gainers'), 'chat')
assert.equal(where('alerts for when TCS drops below 4000'), 'chat')
assert.equal(where('buy 50 TCS at market'), 'chat')

// A destination this app doesn't have falls through to the agent rather than guessing.
assert.equal(where('open the options chain'), 'chat')
assert.equal(where('go to mars'), 'chat')

// A focused text field means dictation, whatever the words are - this is the safety rule.
assert.equal(route('delete everything', { intoField: true }).kind, 'dictate')
assert.equal(route('open bar replay', { intoField: true }).kind, 'dictate')
assert.equal(route('chased the breakout, moved my stop', { intoField: true }).text, 'chased the breakout, moved my stop')

// Nothing said, nothing done.
assert.equal(route('').kind, 'empty')
assert.equal(route('   ', { intoField: true }).kind, 'empty')

// Every target is reachable by saying its own label, and no label matches another's phrase better
// than itself - a new page added to navTargets that collides with an existing one fails here.
for (const target of NAV_TARGETS) {
  const match = matchNavTarget(target.label)
  assert.ok(match, `no match for ${target.label}`)
  assert.equal(match.target.label, target.label, `"${target.label}" matched "${match.target.label}"`)
}

console.log(`ok - voiceCommands: navigation verbs, aliases, dictation, fallthrough, ${NAV_TARGETS.length} targets`)

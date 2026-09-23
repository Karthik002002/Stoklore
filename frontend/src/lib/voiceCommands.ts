// What a spoken phrase does. Pure and dependency-free (relative imports, no '@/' alias) so
// voiceCommands.selfcheck.mjs can run it under plain `node`.
//
// Three outcomes, in this order:
//   dictate  - a text field was focused when the key was pressed. You meant to type, so nothing is
//              executed, whatever the words were. This is what makes dictation safe: "delete the
//              trade" typed into a notes box must never become an action.
//   navigate - "open bar replay", "go to the journal": a navigation verb plus a place this app has.
//   chat     - everything else goes to the agent, which has the tools to act on it.
import { NAV_TARGETS, type NavTarget } from './navTargets.ts'

/** Lowercase, no punctuation, single spaces - Whisper returns "Open bar replay." */
export const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Said before a destination. "show me", "take me to", "jump to"... all mean the same thing, and
// the word that follows is the place.
const NAV_VERB =
  /^(?:please\s+)?(?:can you\s+)?(?:open|go to|goto|show me|show|navigate to|take me to|switch to|jump to|back to)\s+/

// Words people put in a spoken destination that aren't in the label: "the journal page".
const NOISE = new Set(['the', 'a', 'my', 'page', 'tab', 'screen', 'section', 'view', 'please'])

/** Spoken names that don't appear in any label. The journal is called Backtesting in the UI, and
 *  nobody says "backtesting trades" out loud. */
const ALIASES: Record<string, string> = {
  journal: 'backtesting trades',
  'trade journal': 'backtesting trades',
  trades: 'backtesting trades',
  home: 'stocks',
  news: 'top news',
  replay: 'bar replay',
  'bar replay': 'bar replay',
  portfolio: 'holdings',
  simulation: 'trade simulation',
  statistics: 'backtesting statistics',
  stats: 'backtesting statistics',
  reviews: 'backtesting reviews',
  goals: 'backtesting goals',
}

const words = (text: string) =>
  normalize(text)
    .split(' ')
    .filter((w) => w && !NOISE.has(w))

/** 0-1: how well a spoken phrase names a target. 1 is "said it exactly". */
export function scoreTarget(phrase: string, label: string) {
  const said = words(phrase)
  const target = words(label)
  if (!said.length || !target.length) return 0
  const saidText = said.join(' ')
  const targetText = target.join(' ')
  if (saidText === targetText) return 1
  // "settings" names "Settings > Model" only partly - a phrase that IS the whole label's tail
  // ("trade accounts") is a better match than one that's a prefix of many labels.
  if (targetText.endsWith(saidText) || targetText.startsWith(saidText)) return 0.9
  const hit = target.filter((w) => said.includes(w)).length
  const coverage = hit / target.length
  const precision = hit / said.length
  return Math.min(coverage, precision) * 0.85
}

/** The best destination for a phrase, or null. `minScore` is deliberately high: navigating to the
 *  wrong page is more annoying than falling through to the chat agent, which can ask. */
export function matchNavTarget(phrase: string, targets: NavTarget[] = NAV_TARGETS, minScore = 0.8) {
  // Aliases are looked up on the noise-stripped phrase, so "the journal page" finds "journal".
  const spoken = words(phrase).join(' ')
  const aliased = ALIASES[spoken] ?? spoken
  let best: { target: NavTarget; score: number } | null = null
  for (const target of targets) {
    const score = scoreTarget(aliased, target.label)
    if (score > (best?.score ?? 0)) best = { target, score }
  }
  return best && best.score >= minScore ? best : null
}

export type VoiceRoute =
  | { kind: 'dictate'; text: string }
  | { kind: 'navigate'; text: string; target: NavTarget }
  | { kind: 'chat'; text: string }
  | { kind: 'empty' }

/** What to do with a transcript. `intoField` is whether a text field had focus when the key went
 *  down - not when it came up, because starting to talk is when the intent was formed. */
export function routeTranscript(
  text: string,
  { intoField = false, targets = NAV_TARGETS }: { intoField?: boolean; targets?: NavTarget[] } = {},
): VoiceRoute {
  const said = text.trim()
  if (!said) return { kind: 'empty' }
  if (intoField) return { kind: 'dictate', text: said }

  const stripped = normalize(said).replace(NAV_VERB, '')
  const hadVerb = stripped !== normalize(said)
  // Without a navigation verb the bar is exact: "top news" navigates, but "top news on TCS today"
  // is a question for the agent.
  const match = matchNavTarget(stripped, targets, hadVerb ? 0.8 : 1)
  if (match) return { kind: 'navigate', text: said, target: match.target }
  return { kind: 'chat', text: said }
}

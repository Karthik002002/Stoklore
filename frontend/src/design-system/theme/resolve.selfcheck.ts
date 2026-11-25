// node src/design-system/theme/resolve.selfcheck.ts
import assert from 'node:assert/strict'
import { isColor, resolveTheme, sanitizeState, themeVars, toPreset } from './resolve.ts'
import { THEMES } from '../tokens/themes.ts'

assert.ok(isColor('#fff') && isColor('#12ab34') && isColor('#12ab34cc') && isColor('oklch(0.7 0.1 250)'))
assert.ok(!isColor('red;}body{display:none') && !isColor('url(x)') && !isColor('#12345') && !isColor(3))

// junk in -> defaults out
assert.deepEqual(sanitizeState(null), { presetId: 'terminal-dark', overrides: {} })
assert.deepEqual(sanitizeState('x'), { presetId: 'terminal-dark', overrides: {} })

const s = sanitizeState({
  presetId: 'midnight',
  overrides: { accent: '#ff0000', nope: '#fff', up: 'javascript:1', down: ' #00ff00 ' },
  radius: 99,
  density: 'huge',
})
assert.deepEqual(s, { presetId: 'midnight', overrides: { accent: '#ff0000', down: '#00ff00' }, radius: 16 })
assert.equal(sanitizeState({ presetId: 'gone' }).presetId, 'terminal-dark')

const r = resolveTheme(s)
assert.equal(r.colors.accent, '#ff0000')
assert.equal(r.colors.card, THEMES.find((t) => t.id === 'midnight')!.colors.card)
assert.equal(r.density, 'compact')

const v = themeVars(r)
assert.equal(v['--accent'], '#ff0000')
assert.equal(v['--radius'], '16px')
assert.equal(v['--control-h'], '26px')

// every preset defines every token, and all of them are valid colors
const tokens = Object.keys(THEMES[0].colors)
for (const t of THEMES) {
  assert.deepEqual(Object.keys(t.colors).sort(), [...tokens].sort(), `${t.id} token set`)
  for (const [k, c] of Object.entries(t.colors)) assert.ok(isColor(c), `${t.id}.${k}=${c}`)
  if (t.pair)
    assert.ok(
      THEMES.some((p) => p.id === t.pair),
      `${t.id} pair`,
    )
}

const p = toPreset(r)
assert.equal(p.id, 'my-theme')
assert.equal(p.colors.accent, '#ff0000')
assert.equal(p.radius, 16)

console.log('resolve.selfcheck: ok')

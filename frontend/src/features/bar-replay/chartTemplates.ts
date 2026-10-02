import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChartSettings, IndicatorConfig } from './store'
import { DEFAULT_CHART_SETTINGS, useBarReplayStore } from './store'

// Named chart setups - indicators plus how the candles and RSI levels look - that every chart
// reading the Bar Replay store (Bar Replay, paper/scan/modal charts, live positions) can switch to.
// A template is a snapshot: applying one copies it into the store, editing the chart afterwards
// edits the store, and "Save" writes the store back over the template.

/** The part of ChartSettings that is about looks (candles, canvas, oscillator levels). Order sizing
 *  and blind replay are trading preferences, not chart style - a template never touches them. */
const STYLE_KEYS = [
  'bodyUpColor',
  'bodyDownColor',
  'wickUpColor',
  'wickDownColor',
  'borderVisible',
  'borderUpColor',
  'borderDownColor',
  'rsiLevels',
  'levelUpperColor',
  'levelLowerColor',
  'levelBandVisible',
  'levelBandColor',
  'background',
  'gridColor',
  'textColor',
  'horzGridVisible',
  'vertGridVisible',
  'volumeVisible',
  'lastPriceLine',
] as const
export type ChartStyle = Pick<ChartSettings, (typeof STYLE_KEYS)[number]>

export type ChartTemplate = { id: string; name: string; indicators: IndicatorConfig[]; style: ChartStyle }

export const styleOf = (s: ChartSettings): ChartStyle =>
  Object.fromEntries(STYLE_KEYS.map((k) => [k, s[k]])) as ChartStyle

// Keys are random per add, so two identical setups would never compare equal on them. Missing
// style keys (a template saved before a setting existed) read as the default.
const fingerprint = (indicators: IndicatorConfig[], style: ChartStyle) =>
  JSON.stringify([
    indicators.map(({ key: _, ...rest }) => rest),
    STYLE_KEYS.map((k) => style[k] ?? DEFAULT_CHART_SETTINGS[k]),
  ])

export const sameSetup = (t: ChartTemplate, indicators: IndicatorConfig[], settings: ChartSettings) =>
  fingerprint(t.indicators, t.style) === fingerprint(indicators, styleOf(settings))

type TemplateState = {
  templates: ChartTemplate[]
  /** The template last applied or saved - what "Save" overwrites. */
  activeId: string | null
  upsert: (t: ChartTemplate) => void
  remove: (id: string) => void
  setActiveId: (id: string | null) => void
}

export const useChartTemplates = create<TemplateState>()(
  persist(
    (set) => ({
      templates: [],
      activeId: null,
      upsert: (t) =>
        set((s) => ({
          templates: s.templates.some((x) => x.id === t.id)
            ? s.templates.map((x) => (x.id === t.id ? t : x))
            : [...s.templates, t],
        })),
      remove: (id) =>
        set((s) => ({ templates: s.templates.filter((t) => t.id !== id), activeId: s.activeId === id ? null : s.activeId })),
      setActiveId: (activeId) => set({ activeId }),
    }),
    { name: 'chartTemplates', version: 1 },
  ),
)

/** The chart's current setup against its templates: apply one, save over the active one, or save
 *  the current setup under a new name. `dirty` = the chart no longer matches the active template. */
export function useChartTemplate() {
  const indicators = useBarReplayStore((s) => s.indicators)
  const settings = useBarReplayStore((s) => s.settings)
  const { templates, activeId, upsert, setActiveId } = useChartTemplates()
  const active = templates.find((t) => t.id === activeId) ?? null
  const dirty = !!active && !sameSetup(active, indicators, settings)

  const apply = (t: ChartTemplate) => {
    const store = useBarReplayStore.getState()
    store.setIndicators(t.indicators.map((i) => ({ ...i, key: crypto.randomUUID() })))
    // defaults first: a template saved before a setting existed means that setting's default
    store.setSettings({ ...store.settings, ...styleOf(DEFAULT_CHART_SETTINGS), ...t.style })
    setActiveId(t.id)
  }
  const saveActive = () => active && upsert({ ...active, indicators, style: styleOf(settings) })
  const saveAs = (name: string) => {
    const t = { id: crypto.randomUUID(), name, indicators, style: styleOf(settings) }
    upsert(t)
    setActiveId(t.id)
  }
  return { templates, active, dirty, apply, saveActive, saveAs }
}

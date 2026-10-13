import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// The home page's own layout: which panels show, and where each grid panel sits and how big it is.
// Per browser (localStorage, through zustand's persist) - the home terminal is a personal screen, and
// the shared, saved-on-the-server layouts are what Dashboards are for.

export type PanelLayout = { x: number; y: number; w: number; h: number }

/** Every home panel, in the order the customise sheet lists them. `layout` = a grid panel and its
 *  default place (12 columns, 36px rows); no layout = a full-width strip that can only be shown or
 *  hidden (the ticker tape above the grid, the status bar below it). */
export const HOME_PANELS: { id: string; label: string; hint: string; layout?: PanelLayout }[] = [
  { id: 'ticker', label: 'Ticker tape', hint: 'Scrolling indices across the top' },
  {
    id: 'indices',
    label: 'Indices',
    hint: 'NIFTY, SENSEX, global indices',
    layout: { x: 0, y: 0, w: 3, h: 11 },
  },
  {
    id: 'watchlist',
    label: 'Watchlist',
    hint: 'Your tracked stocks and lists',
    layout: { x: 3, y: 0, w: 6, h: 11 },
  },
  {
    id: 'pulse',
    label: 'Market pulse',
    hint: 'Breadth and movers of your stocks',
    layout: { x: 9, y: 0, w: 3, h: 11 },
  },
  {
    id: 'attention',
    label: 'Unusual attention',
    hint: 'Stocks with more events than usual',
    layout: { x: 0, y: 11, w: 4, h: 9 },
  },
  {
    id: 'events',
    label: 'Recent events',
    hint: 'Latest events on your stocks',
    layout: { x: 4, y: 11, w: 4, h: 9 },
  },
  {
    id: 'movers',
    label: 'Top gainers / losers',
    hint: "NSE's top movers by index bucket",
    layout: { x: 8, y: 11, w: 4, h: 9 },
  },
  {
    id: 'macro',
    label: 'Macro indices',
    hint: "NSE's index performance table",
    layout: { x: 0, y: 20, w: 12, h: 8 },
  },
  {
    id: 'sectors',
    label: 'Sector performance',
    hint: 'ET Markets sectors, breadth and members',
    layout: { x: 0, y: 28, w: 12, h: 18 },
  },
  { id: 'status', label: 'Status bar', hint: 'Session, latency and last update' },
]

export const DEFAULT_LAYOUT: Record<string, PanelLayout> = Object.fromEntries(
  HOME_PANELS.filter((p) => p.layout).map((p) => [p.id, p.layout!]),
)

type HomeLayoutState = {
  layout: Record<string, PanelLayout>
  hidden: string[]
  /** Drag/resize mode. Not persisted: a reload always comes back to a fixed page. */
  editing: boolean
  setLayout: (items: { i: string; x: number; y: number; w: number; h: number }[]) => void
  setHidden: (id: string, hidden: boolean) => void
  setEditing: (editing: boolean) => void
  reset: () => void
}

export const useHomeLayout = create<HomeLayoutState>()(
  persist(
    (set) => ({
      layout: DEFAULT_LAYOUT,
      hidden: [],
      editing: false,
      // Merged, not replaced: the grid only reports the panels on screen, and a hidden one has to
      // come back where it was.
      // Only when something actually moved: the grid reports its layout on every render, and a fresh
      // object each time would re-render the page into another report.
      setLayout: (items) =>
        set((s) => {
          const moved = items.filter(({ i, x, y, w, h }) => {
            const was = s.layout[i]
            return !was || was.x !== x || was.y !== y || was.w !== w || was.h !== h
          })
          if (!moved.length) return s
          return {
            layout: {
              ...s.layout,
              ...Object.fromEntries(moved.map(({ i, x, y, w, h }) => [i, { x, y, w, h }])),
            },
          }
        }),
      setHidden: (id, hidden) =>
        set((s) => ({ hidden: hidden ? [...new Set([...s.hidden, id])] : s.hidden.filter((h) => h !== id) })),
      setEditing: (editing) => set({ editing }),
      reset: () => set({ layout: DEFAULT_LAYOUT, hidden: [] }),
    }),
    {
      name: 'home.layout',
      version: 1,
      partialize: ({ layout, hidden }) => ({ layout, hidden }),
      // A panel added after the layout was saved has no entry - it gets its default place.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<HomeLayoutState>
        return { ...current, ...p, layout: { ...DEFAULT_LAYOUT, ...p.layout } }
      },
    },
  ),
)

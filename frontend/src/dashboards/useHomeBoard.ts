import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getHomeBoard, saveHomeBoard } from '@/services/api'
import type { DashboardPanel, HomeBoard, HomePin } from '@/services/api'
import { newPanelId } from './shared'

const KEY = ['homeBoard']
const EMPTY: HomePin[] = []

/** The home page's pins, and the calls that change them. Every change saves straight away - the board
 *  is a list of references, so there is no draft worth guarding. */
export function useHomeBoard() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: getHomeBoard })
  const items = data?.items ?? EMPTY

  const save = useMutation({
    mutationFn: saveHomeBoard,
    // Optimistic: a drag that waits on the server snaps back and then jumps.
    onMutate: (next: HomeBoard) => {
      const previous = queryClient.getQueryData<HomeBoard>(KEY)
      queryClient.setQueryData(KEY, next)
      return { previous }
    },
    onError: (e: Error, _next, context) => {
      queryClient.setQueryData(KEY, context?.previous)
      toast.error(e.message, { id: 'home-board' })
    },
  })
  const setItems = (next: HomePin[]) => save.mutate({ items: next })

  const findPin = (dashboardId: string, panelId: string | null = null) =>
    items.find((i) => i.dashboard_id === dashboardId && i.panel_id === panelId)

  /** Pins a dashboard (no panel) or one of its panels to the bottom of the board, or unpins it. */
  const togglePin = (
    dashboardId: string,
    panel: DashboardPanel | null,
    dashboardPanels: DashboardPanel[] = [],
  ) => {
    const existing = findPin(dashboardId, panel?.id ?? null)
    if (existing) {
      setItems(items.filter((i) => i.id !== existing.id))
      toast.message('Unpinned from home', { id: 'home-board' })
      return
    }
    const y = Math.max(0, ...items.map((i) => i.layout.y + i.layout.h))
    // A panel keeps its own size; a dashboard gets the full width and the height its grid needs,
    // plus a row for its header, within reason - it scrolls inside past that.
    const bottom = Math.max(0, ...dashboardPanels.map((p) => p.layout.y + p.layout.h))
    const layout = panel
      ? { x: 0, y, w: panel.layout.w, h: panel.layout.h }
      : { x: 0, y, w: 12, h: Math.min(Math.max(bottom + 1, 6), 24) }
    setItems([...items, { id: newPanelId(), dashboard_id: dashboardId, panel_id: panel?.id ?? null, layout }])
    toast.success('Pinned to home', { id: 'home-board' })
  }

  return { items, isLoading, setItems, findPin, togglePin }
}

import { useNavigate, useSearch } from '@tanstack/react-router'
import { Tabs, TabsIndicator, TabsList, TabsTab } from '@/components/ui/tabs'
import HomeBoard from '@/dashboards/HomeBoard'
import { useHomeBoard } from '@/dashboards/useHomeBoard'
import StocksList from './StocksList'

export type HomeTab = 'home' | 'board'
const LAST_TAB = 'home.tab'

const readLastTab = (): HomeTab | null => {
  try {
    const value = localStorage.getItem(LAST_TAB)
    return value === 'home' || value === 'board' ? value : null
  } catch {
    return null
  }
}

// The landing page: the stocks terminal ("Home") and "My board" - dashboards and panels you pinned.
// It opens on the tab in the URL, else the one you used last, else My board once anything is pinned -
// so pinning is what makes home show what you chose, without a separate preference to set.
export default function Home() {
  const navigate = useNavigate({ from: '/' })
  const search = useSearch({ from: '/' })
  const { items, isLoading } = useHomeBoard()

  const tab: HomeTab = search.tab ?? readLastTab() ?? (items.length ? 'board' : 'home')
  const setTab = (next: HomeTab) => {
    try {
      localStorage.setItem(LAST_TAB, next)
    } catch {
      // Private mode - the URL still carries the choice for this visit.
    }
    navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })
  }

  // Deciding before the pins load would flash Home and then jump to My board.
  if (isLoading && !search.tab && !readLastTab()) return null

  return (
    <div className="space-y-2">
      <Tabs value={tab} onValueChange={(v) => setTab(v as HomeTab)} className="gap-0">
        <TabsList>
          <TabsIndicator />
          <TabsTab value="home">Home</TabsTab>
          <TabsTab value="board">My board{items.length ? ` · ${items.length}` : ''}</TabsTab>
        </TabsList>
      </Tabs>
      {tab === 'home' ? <StocksList /> : <HomeBoard />}
    </div>
  )
}

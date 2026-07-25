import { useNavigate, useSearch } from '@tanstack/react-router'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { usePageTitle } from '@/lib/usePageTitle'
import AutoBacktesting from './AutoBacktesting'

export default function Backtesting() {
  usePageTitle('Backtesting')
  const { tab } = useSearch({ from: '/backtesting' })
  const navigate = useNavigate({ from: '/backtesting' })

  return (
    <Tabs value={tab} onValueChange={(next) => navigate({ search: { tab: next } })}>
      <TabsList>
        <TabsTab value="auto">Auto</TabsTab>
        <TabsTab value="manual">Manual</TabsTab>
        <TabsIndicator />
      </TabsList>
      <TabsPanel value="auto">
        <AutoBacktesting />
      </TabsPanel>
      <TabsPanel value="manual" />
    </Tabs>
  )
}

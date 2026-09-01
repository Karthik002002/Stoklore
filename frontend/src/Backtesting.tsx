import { usePageTitle } from '@/lib/usePageTitle'
import ManualBacktesting from './ManualBacktesting'

// Auto backtesting tab disabled for now - Manual is the only mode on this page. To restore the
// Auto/Manual tab switcher, swap this function body back to the commented-out version below
// (and its imports).
export default function Backtesting() {
  usePageTitle('Backtesting')
  return <ManualBacktesting />
}

// import { useNavigate, useSearch } from '@tanstack/react-router'
// import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
// import { usePageTitle } from '@/lib/usePageTitle'
// import AutoBacktesting from './AutoBacktesting'
// import ManualBacktesting from './ManualBacktesting'
//
// export default function Backtesting() {
//   usePageTitle('Backtesting')
//   const { tab } = useSearch({ from: '/backtesting' })
//   const navigate = useNavigate({ from: '/backtesting' })
//
//   return (
//     <Tabs value={tab} onValueChange={(next) => navigate({ search: { tab: next } })}>
//       <TabsList>
//         <TabsTab value="auto">Auto</TabsTab>
//         <TabsTab value="manual">Manual</TabsTab>
//         <TabsIndicator />
//       </TabsList>
//       <TabsPanel value="auto">
//         <AutoBacktesting />
//       </TabsPanel>
//       <TabsPanel value="manual">
//         <ManualBacktesting />
//       </TabsPanel>
//     </Tabs>
//   )
// }

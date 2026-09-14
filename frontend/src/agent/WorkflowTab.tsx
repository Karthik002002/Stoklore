import { useState } from 'react'
import WorkflowData from './WorkflowData'
import WorkflowEditor from './WorkflowEditor'
import WorkflowList from './WorkflowList'

// The Workflow tab is a two-screen thing: the list of what you've built, and the editor for one of
// them. Kept in local state rather than the URL because a half-wired canvas isn't a place you'd
// want to link someone to, and the tab itself is already addressable.
export default function WorkflowTab() {
  const [screen, setScreen] = useState<
    { at: 'editor'; id: string | null } | { at: 'data'; id: string; name: string } | null
  >(null)

  if (screen?.at === 'editor') {
    return <WorkflowEditor id={screen.id} onBack={() => setScreen(null)} />
  }
  if (screen?.at === 'data') {
    return <WorkflowData id={screen.id} name={screen.name} onBack={() => setScreen(null)} />
  }
  return (
    <WorkflowList
      onOpen={(id) => setScreen({ at: 'editor', id })}
      onData={(id, name) => setScreen({ at: 'data', id, name })}
    />
  )
}

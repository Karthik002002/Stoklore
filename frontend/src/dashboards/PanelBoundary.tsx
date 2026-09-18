import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

// A panel that throws while drawing takes the whole page down with it - the router's boundary
// replaces the dashboard with an error screen, so one bad panel loses the other eleven. This keeps
// the failure inside the panel that caused it, says so, and offers to draw it again.
//
// `resetKey` changes when the panel is edited or refetched: a boundary that stays broken after the
// cause is fixed is its own bug, so a new key clears the error.

type Props = { children: ReactNode; resetKey?: unknown }
type State = { error: Error | null; key: unknown }

export default class PanelBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  // Clearing the error as the key changes, rather than in componentDidUpdate, keeps it to one render.
  static getDerivedStateFromProps(props: Props, state: State) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Panel failed to render', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-2 text-center">
        <TriangleAlertIcon className="size-4 text-down" />
        <p className="text-xs font-medium">This panel couldn't be drawn</p>
        <p className="max-w-[40ch] truncate text-[11px] text-muted-foreground" title={error.message}>
          {error.message}
        </p>
        <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    )
  }
}

import { ExternalLinkIcon, MoreVerticalIcon, TagIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { tagInChat } from './ChatWidget'

// Shared "..." menu for any event/news/top-news card: Open (redirect to the source) and Tag
// (drop it into the chat input as a scrape_url-able link). No url, nothing to open or scrape -
// so the menu just doesn't render.
export default function EventActionsMenu({ url, label, className = '' }) {
  if (!url) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Event actions" className={className} />}
        onClick={(e) => e.stopPropagation()}
      >
        <MoreVerticalIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
          <ExternalLinkIcon className="size-3.5" />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => tagInChat(url, label)}>
          <TagIcon className="size-3.5" />
          Tag in chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

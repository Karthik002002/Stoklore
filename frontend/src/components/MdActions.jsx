import { CheckIcon, CopyIcon, FileTextIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { copyText, downloadMd } from '@/lib/exportFile'

/** Copy / download the markdown of whatever panel it sits in. `build` is a thunk so a large
 *  report is only assembled when it's actually asked for, not on every render of the page. */
export default function MdActions({ build, name, disabled = false, className = '' }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await copyText(build())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Clipboard blocked — use Markdown to download it instead')
    }
  }

  return (
    <div className={`flex gap-1.5 no-print ${className}`}>
      <Button size="sm" variant="outline" disabled={disabled} onClick={copy}>
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {copied ? 'Copied' : 'Copy MD'}
      </Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => downloadMd(build(), name)}>
        <FileTextIcon className="size-3.5" /> Markdown
      </Button>
    </div>
  )
}

import { useState } from 'react'
import { XIcon } from 'lucide-react'

// Creatable multi-value tag chips: type + Enter/comma adds a chip, Backspace on an empty input
// removes the last one. Folds "Setup"/"Mistake"-style categorization into one freeform field
// rather than separate fixed inputs - the user types whatever tag makes sense.
export default function TagInput({
  value,
  onChange,
  placeholder = 'Add a tag, press Enter…',
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}) {
  const [text, setText] = useState('')

  const addTag = () => {
    const tag = text.trim()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setText('')
  }

  const removeTag = (tag: string) => onChange(value.filter((t) => t !== tag))

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      {value.map((tag) => (
        <span key={tag} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => removeTag(tag)}>
            <XIcon className="size-3 text-muted-foreground hover:text-foreground" />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            addTag()
          } else if (e.key === 'Backspace' && !text && value.length) {
            removeTag(value[value.length - 1])
          }
        }}
        onBlur={addTag}
        placeholder={value.length ? '' : placeholder}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { MicIcon } from 'lucide-react'
import { toast } from 'sonner'
import { askInChat } from './ChatWidget'
import { Spinner } from '@/components/ui/spinner'
import { bindingFor, formatShortcut, keyFromEvent, useShortcutStore } from '@/lib/shortcuts'
import { startRecording, transcribe, type Recorder } from '@/lib/voice'
import { routeTranscript } from '@/lib/voiceCommands'

// Hold-to-talk voice capture, mounted once in App.
//
// Hold the key (Settings › Shortcuts → "Voice capture"), speak, release. Deliberately not a
// toggle: there is never a recording you forgot about, and the mic light goes out the moment you
// let go. What happens to the transcript is lib/voiceCommands.ts's decision - dictation into a
// focused field, navigation, or a message to the chat agent.
//
// useShortcut/useHotkey can't express this: it fires on keydown only, and hold-to-talk needs the
// matching keyup. So this is a pair of window listeners reading the same binding the rest of the
// app uses, which keeps it rebindable and listed in Settings like every other shortcut.

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA'])
// Fields that hold text rather than a checkbox/date/colour - only these accept dictation.
const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', ''])

function editableTarget(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null
  if (el.isContentEditable) return el
  if (!FIELD_TAGS.has(el.tagName)) return null
  if (el instanceof HTMLInputElement && !TEXT_TYPES.has(el.type)) return null
  return el
}

/** Types text into a field the way a keystroke would. React tracks the value on the DOM node, so
 *  assigning `.value` directly leaves its state stale - the native setter plus an input event is
 *  what makes a controlled input actually see it. */
function insertIntoField(el: HTMLElement, text: string) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const spaced = start > 0 && !/\s$/.test(el.value.slice(0, start)) ? ` ${text}` : text
    setter?.call(el, el.value.slice(0, start) + spaced + el.value.slice(end))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    const caret = start + spaced.length
    el.setSelectionRange(caret, caret)
    return
  }
  el.focus()
  document.execCommand('insertText', false, text) // contenteditable (the chat input is Lexical)
}

export default function VoiceCapture() {
  const navigate = useNavigate()
  const binding = useShortcutStore((s) => bindingFor(s.bindings, 'global.voice'))
  const [state, setState] = useState<'idle' | 'recording' | 'thinking'>('idle')
  const recorderRef = useRef<Recorder | null>(null)
  // The field that had focus when the key went DOWN: where dictation lands, even though the key
  // comes up a few seconds later, by which time a toast may have taken focus.
  const fieldRef = useRef<HTMLElement | null>(null)

  const handle = useCallback(
    (text: string) => {
      const route = routeTranscript(text, { intoField: !!fieldRef.current })
      if (route.kind === 'empty') {
        toast.info("Didn't catch that")
        return
      }
      if (route.kind === 'dictate' && fieldRef.current) {
        insertIntoField(fieldRef.current, route.text)
        return
      }
      if (route.kind === 'navigate') {
        toast.success(`Opening ${route.target.label}`)
        navigate(
          (route.target.search
            ? { to: route.target.to, search: route.target.search }
            : { to: route.target.to }) as never,
        )
        return
      }
      askInChat(route.text)
    },
    [navigate],
  )

  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    setState('thinking')
    try {
      handle(await transcribe(await recorder.stop()))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Voice capture failed')
    } finally {
      setState('idle')
      fieldRef.current = null
    }
  }, [handle])

  useEffect(() => {
    if (!binding) return
    const mainKey = binding.split('+').pop() ?? ''

    const onKeyDown = async (event: KeyboardEvent) => {
      if (event.repeat || recorderRef.current || keyFromEvent(event) !== binding) return
      event.preventDefault()
      fieldRef.current = editableTarget(document.activeElement)
      try {
        recorderRef.current = await startRecording()
        setState('recording')
      } catch {
        toast.error('No microphone access — allow it in your browser’s site settings')
        setState('idle')
      }
    }

    // Releasing the key OR any of its modifiers ends the take: on macOS, letting go of ⌘ first
    // means the browser never reports the letter's keyup at all.
    const onKeyUp = (event: KeyboardEvent) => {
      if (!recorderRef.current) return
      const released = event.key.toLowerCase()
      if (released === mainKey || ['meta', 'control', 'shift', 'alt'].includes(released)) void stop()
    }

    // A lost window (⌘-Tab away mid-sentence) would otherwise leave the mic on for ever.
    const onBlur = () => {
      if (recorderRef.current) {
        recorderRef.current.cancel()
        recorderRef.current = null
        setState('idle')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      recorderRef.current?.cancel()
      recorderRef.current = null
    }
  }, [binding, stop])

  if (state === 'idle') return null

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full border bg-card/95 px-4 py-2 text-sm shadow-lg backdrop-blur">
        {state === 'recording' ? (
          <>
            <MicIcon className="size-4 animate-pulse text-red-500" />
            <span>Listening…</span>
            <span className="text-xs text-muted-foreground">release {formatShortcut(binding)}</span>
          </>
        ) : (
          <>
            <Spinner className="size-4" />
            <span>Transcribing…</span>
          </>
        )}
      </div>
    </div>
  )
}

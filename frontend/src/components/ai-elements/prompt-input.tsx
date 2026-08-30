'use client'
import type * as React from 'react'
import type { ComponentProps } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CornerDownLeftIcon, ImageIcon, Monitor, PlusIcon, SquareIcon, XIcon } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Children, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// ============================================================================
// Helpers
// ============================================================================

const convertBlobUrlToDataUrl = async (url: string) => {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    // FileReader uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    return new Promise((resolve) => {
      const reader = new FileReader()
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onloadend = () => resolve(reader.result)
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

const captureScreenshot = async () => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    return null
  }

  let stream = null
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    })

    video.srcObject = stream

    // Video element uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    await new Promise((resolve, reject) => {
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      video.onloadedmetadata = () => resolve(undefined)
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      video.onerror = () => reject(new Error('Failed to load screen stream'))
    })

    await video.play()

    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) {
      return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }

    context.drawImage(video, 0, 0, width, height)
    // canvas.toBlob uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!blob) {
      return null
    }

    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').replace('Z', '')

    return new File([blob], `screenshot-${timestamp}.png`, {
      lastModified: Date.now(),
      type: 'image/png',
    })
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }
    video.pause()
    video.srcObject = null
  }
}

/** A button's tooltip: a plain string, or a string plus how to present it. */
type ButtonTooltip =
  | string
  | { content: React.ReactNode; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right' }

/** A source the user pinned to the message (a stock, a report) - shape is up to the caller apart
 *  from the id this component assigns. */
export type ReferencedSource = { id?: string; [key: string]: unknown }

/** What a submit hands back: the typed text and whatever was attached to it. */
export type PromptSubmitMessage = { text: string; files: PromptAttachment[] }

/** One pending attachment, as this component models it before the message is sent. */
export type PromptAttachment = {
  id: string
  type: 'file'
  filename: string
  mediaType: string
  /** An object URL - revoked on remove and on unmount. */
  url: string
}

/** The attachment API shared through context, whether state lives here or in the provider. */
type AttachmentsApi = {
  add: (files: File[] | FileList) => void
  clear: () => void
  remove: (id: string) => void
  openFileDialog: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  files: PromptAttachment[]
}

/** Everything the optional provider lifts out of PromptInput. */
type PromptController = {
  attachments: AttachmentsApi
  textInput: { value: string; setInput: (value: string) => void; clear: () => void }
  __registerFileInput: (ref: React.RefObject<HTMLInputElement | null>, open: () => void) => void
}

const PromptInputController = createContext<PromptController | null>(null)
const ProviderAttachmentsContext = createContext<AttachmentsApi | null>(null)

export const usePromptInputController = () => {
  const ctx = useContext(PromptInputController)
  if (!ctx) {
    throw new Error('Wrap your component inside <PromptInputProvider> to use usePromptInputController().')
  }
  return ctx
}

// Optional variants (do NOT throw). Useful for dual-mode components.
const useOptionalPromptInputController = () => useContext(PromptInputController)

export const useProviderAttachments = () => {
  const ctx = useContext(ProviderAttachmentsContext)
  if (!ctx) {
    throw new Error('Wrap your component inside <PromptInputProvider> to use useProviderAttachments().')
  }
  return ctx
}

const useOptionalProviderAttachments = () => useContext(ProviderAttachmentsContext)

/**
 * Optional global provider that lifts PromptInput state outside of PromptInput.
 * If you don't use it, PromptInput stays fully self-managed.
 */
export const PromptInputProvider = ({
  initialInput: initialTextInput = '',
  children,
}: {
  initialInput?: string
  children?: React.ReactNode
}) => {
  // ----- textInput state
  const [textInput, setTextInput] = useState(initialTextInput)
  const clearInput = useCallback(() => setTextInput(''), [])

  // ----- attachments state (global when wrapped)
  const [attachmentFiles, setAttachmentFiles] = useState<PromptAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // oxlint-disable-next-line eslint(no-empty-function)
  const openRef = useRef(() => {})

  const add = useCallback((files: File[] | FileList) => {
    const incoming = [...files]
    if (incoming.length === 0) {
      return
    }

    setAttachmentFiles((prev) => [
      ...prev,
      ...incoming.map((file) => ({
        filename: file.name,
        id: nanoid(),
        mediaType: file.type,
        type: 'file' as const,
        url: URL.createObjectURL(file),
      })),
    ])
  }, [])

  const remove = useCallback((id: string) => {
    setAttachmentFiles((prev) => {
      const found = prev.find((f) => f.id === id)
      if (found?.url) {
        URL.revokeObjectURL(found.url)
      }
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const clear = useCallback(() => {
    setAttachmentFiles((prev) => {
      for (const f of prev) {
        if (f.url) {
          URL.revokeObjectURL(f.url)
        }
      }
      return []
    })
  }, [])

  // Keep a ref to attachments for cleanup on unmount (avoids stale closure)
  const attachmentsRef = useRef(attachmentFiles)

  useEffect(() => {
    attachmentsRef.current = attachmentFiles
  }, [attachmentFiles])

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(
    () => () => {
      for (const f of attachmentsRef.current) {
        if (f.url) {
          URL.revokeObjectURL(f.url)
        }
      }
    },
    [],
  )

  const openFileDialog = useCallback(() => {
    openRef.current?.()
  }, [])

  const attachments = useMemo(
    () => ({
      add,
      clear,
      fileInputRef,
      files: attachmentFiles,
      openFileDialog,
      remove,
    }),
    [attachmentFiles, add, remove, clear, openFileDialog],
  )

  const __registerFileInput = useCallback(
    (ref: React.RefObject<HTMLInputElement | null>, open: () => void) => {
      fileInputRef.current = ref.current
      openRef.current = open
    },
    [],
  )

  const controller = useMemo(
    () => ({
      __registerFileInput,
      attachments,
      textInput: {
        clear: clearInput,
        setInput: setTextInput,
        value: textInput,
      },
    }),
    [textInput, clearInput, attachments, __registerFileInput],
  )

  return (
    <PromptInputController.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>
        {children}
      </ProviderAttachmentsContext.Provider>
    </PromptInputController.Provider>
  )
}

// ============================================================================
// Component Context & Hooks
// ============================================================================

const LocalAttachmentsContext = createContext<AttachmentsApi | null>(null)

export const usePromptInputAttachments = () => {
  // Prefer local context (inside PromptInput) as it has validation, fall back to provider
  const provider = useOptionalProviderAttachments()
  const local = useContext(LocalAttachmentsContext)
  const context = local ?? provider
  if (!context) {
    throw new Error('usePromptInputAttachments must be used within a PromptInput or PromptInputProvider')
  }
  return context
}

type ReferencedSourcesApi = {
  add: (incoming: ReferencedSource | ReferencedSource[]) => void
  clear: () => void
  remove: (id: string) => void
  sources: ReferencedSource[]
}

export const LocalReferencedSourcesContext = createContext<ReferencedSourcesApi | null>(null)

export const usePromptInputReferencedSources = () => {
  const ctx = useContext(LocalReferencedSourcesContext)
  if (!ctx) {
    throw new Error(
      'usePromptInputReferencedSources must be used within a LocalReferencedSourcesContext.Provider',
    )
  }
  return ctx
}

export const PromptInputActionAddAttachments = ({
  label = 'Add photos or files',
  ...props
}: ComponentProps<typeof DropdownMenuItem>) => {
  const attachments = usePromptInputAttachments()

  const handleSelect = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault()
      attachments.openFileDialog()
    },
    [attachments],
  )

  return (
    <DropdownMenuItem {...props} onSelect={handleSelect}>
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItem>
  )
}

export const PromptInputActionAddScreenshot = ({
  label = 'Take screenshot',
  onSelect,
  ...props
}: ComponentProps<typeof DropdownMenuItem>) => {
  const attachments = usePromptInputAttachments()

  const handleSelect = useCallback(
    async (event: Parameters<NonNullable<ComponentProps<typeof DropdownMenuItem>['onSelect']>>[0]) => {
      onSelect?.(event)
      if (event.defaultPrevented) {
        return
      }

      try {
        const screenshot = await captureScreenshot()
        if (screenshot) {
          attachments.add([screenshot])
        }
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === 'NotAllowedError' || error.name === 'AbortError')
        ) {
          return
        }
        throw error
      }
    },
    [onSelect, attachments],
  )

  return (
    <DropdownMenuItem {...props} onSelect={handleSelect}>
      <Monitor className="mr-2 size-4" />
      {label}
    </DropdownMenuItem>
  )
}

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: Omit<ComponentProps<'form'>, 'onSubmit' | 'onError'> & {
  /** File-type filter, as an <input accept> string. */
  accept?: string
  multiple?: boolean
  /** Accept files dropped anywhere on the page, not just on the composer. */
  globalDrop?: boolean
  /** Mirror the accepted files into the hidden <input type="file">. */
  syncHiddenInput?: boolean
  maxFiles?: number
  /** Bytes. */
  maxFileSize?: number
  onError?: (error: { code: string; message: string }) => void
  onSubmit?: (message: PromptSubmitMessage, event: React.FormEvent<HTMLFormElement>) => void
}) => {
  // Try to use a provider controller if present
  const controller = useOptionalPromptInputController()
  const usingProvider = !!controller

  // Refs
  const inputRef = useRef<HTMLInputElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  // ----- Local attachments (only used when no provider)
  const [items, setItems] = useState<PromptAttachment[]>([])
  const files = usingProvider ? controller.attachments.files : items

  // ----- Local referenced sources (always local to PromptInput)
  const [referencedSources, setReferencedSources] = useState<ReferencedSource[]>([])

  // Keep a ref to files for cleanup on unmount (avoids stale closure)
  const filesRef = useRef(files)

  useEffect(() => {
    filesRef.current = files
  }, [files])

  const openFileDialogLocal = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === '') {
        return true
      }

      const patterns = accept
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      return patterns.some((pattern) => {
        if (pattern.endsWith('/*')) {
          // e.g: image/* -> image/
          const prefix = pattern.slice(0, -1)
          return f.type.startsWith(prefix)
        }
        return f.type === pattern
      })
    },
    [accept],
  )

  const addLocal = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = [...fileList]
      const accepted = incoming.filter((f) => matchesAccept(f))
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: 'accept',
          message: 'No files match the accepted types.',
        })
        return
      }
      const withinSize = (f: File) => (maxFileSize ? f.size <= maxFileSize : true)
      const sized = accepted.filter(withinSize)
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: 'max_file_size',
          message: 'All files exceed the maximum size.',
        })
        return
      }

      setItems((prev) => {
        const capacity = typeof maxFiles === 'number' ? Math.max(0, maxFiles - prev.length) : undefined
        const capped = typeof capacity === 'number' ? sized.slice(0, capacity) : sized
        if (typeof capacity === 'number' && sized.length > capacity) {
          onError?.({
            code: 'max_files',
            message: 'Too many files. Some were not added.',
          })
        }
        const next = []
        for (const file of capped) {
          next.push({
            filename: file.name,
            id: nanoid(),
            mediaType: file.type,
            type: 'file' as const,
            url: URL.createObjectURL(file),
          })
        }
        return [...prev, ...next]
      })
    },
    [matchesAccept, maxFiles, maxFileSize, onError],
  )

  const removeLocal = useCallback(
    (id: string) =>
      setItems((prev) => {
        const found = prev.find((file) => file.id === id)
        if (found?.url) {
          URL.revokeObjectURL(found.url)
        }
        return prev.filter((file) => file.id !== id)
      }),
    [],
  )

  // Wrapper that validates files before calling provider's add
  const addWithProviderValidation = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = [...fileList]
      const accepted = incoming.filter((f) => matchesAccept(f))
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: 'accept',
          message: 'No files match the accepted types.',
        })
        return
      }
      const withinSize = (f: File) => (maxFileSize ? f.size <= maxFileSize : true)
      const sized = accepted.filter(withinSize)
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: 'max_file_size',
          message: 'All files exceed the maximum size.',
        })
        return
      }

      const currentCount = files.length
      const capacity = typeof maxFiles === 'number' ? Math.max(0, maxFiles - currentCount) : undefined
      const capped = typeof capacity === 'number' ? sized.slice(0, capacity) : sized
      if (typeof capacity === 'number' && sized.length > capacity) {
        onError?.({
          code: 'max_files',
          message: 'Too many files. Some were not added.',
        })
      }

      if (capped.length > 0) {
        controller?.attachments.add(capped)
      }
    },
    [matchesAccept, maxFileSize, maxFiles, onError, files.length, controller],
  )

  const clearAttachments = useCallback(
    () =>
      usingProvider
        ? controller?.attachments.clear()
        : setItems((prev) => {
            for (const file of prev) {
              if (file.url) {
                URL.revokeObjectURL(file.url)
              }
            }
            return []
          }),
    [usingProvider, controller],
  )

  const clearReferencedSources = useCallback(() => setReferencedSources([]), [])

  const add = usingProvider ? addWithProviderValidation : addLocal
  const remove = usingProvider ? controller.attachments.remove : removeLocal
  const openFileDialog = usingProvider ? controller.attachments.openFileDialog : openFileDialogLocal

  const clear = useCallback(() => {
    clearAttachments()
    clearReferencedSources()
  }, [clearAttachments, clearReferencedSources])

  // Let provider know about our hidden file input so external menus can call openFileDialog()
  useEffect(() => {
    if (!usingProvider) {
      return
    }
    controller.__registerFileInput(inputRef, () => inputRef.current?.click())
  }, [usingProvider, controller])

  // Note: File input cannot be programmatically set for security reasons
  // The syncHiddenInput prop is no longer functional
  useEffect(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = ''
    }
  }, [files, syncHiddenInput])

  // Attach drop handlers on nearest form and document (opt-in)
  useEffect(() => {
    const form = formRef.current
    if (!form) {
      return
    }
    if (globalDrop) {
      // when global drop is on, let the document-level handler own drops
      return
    }

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files)
      }
    }
    form.addEventListener('dragover', onDragOver)
    form.addEventListener('drop', onDrop)
    return () => {
      form.removeEventListener('dragover', onDragOver)
      form.removeEventListener('drop', onDrop)
    }
  }, [add, globalDrop])

  useEffect(() => {
    if (!globalDrop) {
      return
    }

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files)
      }
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [add, globalDrop])

  useEffect(
    () => () => {
      if (!usingProvider) {
        for (const f of filesRef.current) {
          if (f.url) {
            URL.revokeObjectURL(f.url)
          }
        }
      }
    },
    [usingProvider],
  )

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files)
      }
      // Reset input value to allow selecting files that were previously removed
      event.currentTarget.value = ''
    },
    [add],
  )

  const attachmentsCtx = useMemo(
    () => ({
      add,
      clear: clearAttachments,
      fileInputRef: inputRef,
      files: files.map((item) => ({ ...item, id: item.id })),
      openFileDialog,
      remove,
    }),
    [files, add, remove, clearAttachments, openFileDialog],
  )

  const refsCtx = useMemo(
    () => ({
      add: (incoming: ReferencedSource | ReferencedSource[]) => {
        const array = Array.isArray(incoming) ? incoming : [incoming]
        setReferencedSources((prev) => [...prev, ...array.map((s) => ({ ...s, id: nanoid() }))])
      },
      clear: clearReferencedSources,
      remove: (id: string) => {
        setReferencedSources((prev) => prev.filter((s) => s.id !== id))
      },
      sources: referencedSources,
    }),
    [referencedSources, clearReferencedSources],
  )

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      const form = event.currentTarget
      const text = usingProvider
        ? controller.textInput.value
        : (() => {
            const formData = new FormData(form)
            return String(formData.get('message') ?? '')
          })()

      // Reset form immediately after capturing text to avoid race condition
      // where user input during async blob conversion would be lost
      if (!usingProvider) {
        form.reset()
      }

      try {
        // Convert blob URLs to data URLs asynchronously
        const convertedFiles = await Promise.all(
          files.map(async ({ id: _id, ...item }) => {
            if (item.url?.startsWith('blob:')) {
              const dataUrl = await convertBlobUrlToDataUrl(item.url)
              // If conversion failed, keep the original blob URL
              return {
                ...item,
                url: dataUrl ?? item.url,
              }
            }
            return item
          }),
        )

        const result = onSubmit?.({ files: convertedFiles as PromptAttachment[], text }, event)

        // Handle both sync and async onSubmit
        if (result && typeof (result as Promise<void>).then === 'function') {
          try {
            await result
            clear()
            if (usingProvider) {
              controller.textInput.clear()
            }
          } catch {
            // Don't clear on error - user may want to retry
          }
        } else {
          // Sync function completed without throwing, clear inputs
          clear()
          if (usingProvider) {
            controller.textInput.clear()
          }
        }
      } catch {
        // Don't clear on error - user may want to retry
      }
    },
    [usingProvider, controller, files, onSubmit, clear],
  )

  // Render with or without local provider
  const inner = (
    <>
      <input
        accept={accept}
        aria-label="Upload files"
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title="Upload files"
        type="file"
      />
      <form className="w-full" onSubmit={handleSubmit} ref={formRef} {...props}>
        <InputGroup className={cn('overflow-hidden', className)}>{children}</InputGroup>
      </form>
    </>
  )

  const withReferencedSources = (
    <LocalReferencedSourcesContext.Provider value={refsCtx}>{inner}</LocalReferencedSourcesContext.Provider>
  )

  // Always provide LocalAttachmentsContext so children get validated add function
  return (
    <LocalAttachmentsContext.Provider value={attachmentsCtx}>
      {withReferencedSources}
    </LocalAttachmentsContext.Provider>
  )
}

export const PromptInputBody = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('contents', className)} {...props} />
)

export const PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = 'What would you like to know?',
  ...props
}: ComponentProps<'textarea'>) => {
  const controller = useOptionalPromptInputController()
  const attachments = usePromptInputAttachments()
  const [isComposing, setIsComposing] = useState(false)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Call the external onKeyDown handler first
      onKeyDown?.(e)

      // If the external handler prevented default, don't run internal logic
      if (e.defaultPrevented) {
        return
      }

      if (e.key === 'Enter') {
        if (isComposing || e.nativeEvent.isComposing) {
          return
        }
        if (e.shiftKey) {
          return
        }
        e.preventDefault()

        // Check if the submit button is disabled before submitting
        const { form } = e.currentTarget
        const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
        if (submitButton?.disabled) {
          return
        }

        form?.requestSubmit()
      }

      // Remove last attachment when Backspace is pressed and textarea is empty
      if (e.key === 'Backspace' && e.currentTarget.value === '' && attachments.files.length > 0) {
        e.preventDefault()
        const lastAttachment = attachments.files.at(-1)
        if (lastAttachment) {
          attachments.remove(lastAttachment.id)
        }
      }
    },
    [onKeyDown, isComposing, attachments],
  )

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items

      if (!items) {
        return
      }

      const files = []

      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) {
            files.push(file)
          }
        }
      }

      if (files.length > 0) {
        event.preventDefault()
        attachments.add(files)
      }
    },
    [attachments],
  )

  const handleCompositionEnd = useCallback(() => setIsComposing(false), [])
  const handleCompositionStart = useCallback(() => setIsComposing(true), [])

  const controlledProps = controller
    ? {
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
          controller.textInput.setInput(e.currentTarget.value)
          onChange?.(e)
        },
        value: controller.textInput.value,
      }
    : {
        onChange,
      }

  return (
    <InputGroupTextarea
      className={cn('field-sizing-content max-h-48 min-h-16', className)}
      name="message"
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
      {...controlledProps}
    />
  )
}

export const PromptInputHeader = ({ className, ...props }: ComponentProps<typeof InputGroupAddon>) => (
  <InputGroupAddon align="block-end" className={cn('order-first flex-wrap gap-1', className)} {...props} />
)

export const PromptInputFooter = ({ className, ...props }: ComponentProps<typeof InputGroupAddon>) => (
  <InputGroupAddon align="block-end" className={cn('justify-between gap-1', className)} {...props} />
)

export const PromptInputTools = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('flex min-w-0 items-center gap-1', className)} {...props} />
)

export const PromptInputButton = ({
  variant = 'ghost',
  className,
  size,
  tooltip,
  ...props
}: ComponentProps<typeof InputGroupButton> & { tooltip?: ButtonTooltip }) => {
  const newSize = size ?? (Children.count(props.children) > 1 ? 'sm' : 'icon-sm')

  const button = (
    <InputGroupButton className={cn(className)} size={newSize} type="button" variant={variant} {...props} />
  )

  if (!tooltip) {
    return button
  }

  const tooltipContent = typeof tooltip === 'string' ? tooltip : tooltip.content
  const shortcut = typeof tooltip === 'string' ? undefined : tooltip.shortcut
  const side = typeof tooltip === 'string' ? 'top' : (tooltip.side ?? 'top')

  return (
    <Tooltip>
      <TooltipTrigger>{button}</TooltipTrigger>
      <TooltipContent side={side}>
        {tooltipContent}
        {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

export const PromptInputActionMenu = (props: ComponentProps<'div'>) => <DropdownMenu {...props} />

export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: ComponentProps<typeof PromptInputButton>) => (
  <DropdownMenuTrigger render={<PromptInputButton className={className} {...props} />}>
    {children ?? <PlusIcon className="size-4" />}
  </DropdownMenuTrigger>
)

export const PromptInputActionMenuContent = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) => (
  <DropdownMenuContent align="start" className={cn(className)} {...props} />
)

export const PromptInputActionMenuItem = ({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuItem>) => <DropdownMenuItem className={cn(className)} {...props} />

export const PromptInputSubmit = ({
  className,
  variant = 'default',
  size = 'icon-sm',
  status,
  onStop,
  onClick,
  children,
  ...props
}: ComponentProps<typeof InputGroupButton> & {
  /** The AI SDK's stream status - anything but idle turns this into a stop button. */
  status?: 'submitted' | 'streaming' | 'ready' | 'error'
  onStop?: () => void
}) => {
  const isGenerating = status === 'submitted' || status === 'streaming'

  let Icon = <CornerDownLeftIcon className="size-4" />

  if (status === 'submitted') {
    Icon = <Spinner />
  } else if (status === 'streaming') {
    Icon = <SquareIcon className="size-4" />
  } else if (status === 'error') {
    Icon = <XIcon className="size-4" />
  }

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        e.preventDefault()
        onStop?.()
        return
      }
      // Base UI wraps the DOM event; the handler only reads the parts React's own type has.
      onClick?.(e as Parameters<NonNullable<typeof onClick>>[0])
    },
    [isGenerating, onStop, onClick],
  )

  return (
    <InputGroupButton
      aria-label={isGenerating ? 'Stop' : 'Submit'}
      className={cn(className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? 'button' : 'submit'}
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  )
}

export const PromptInputSelect = (props: ComponentProps<'div'>) => <Select {...props} />

export const PromptInputSelectTrigger = ({ className, ...props }: ComponentProps<typeof SelectTrigger>) => (
  <SelectTrigger
    className={cn(
      'border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors',
      'hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
      className,
    )}
    {...props}
  />
)

export const PromptInputSelectContent = ({ className, ...props }: ComponentProps<typeof SelectContent>) => (
  <SelectContent className={cn(className)} {...props} />
)

export const PromptInputSelectItem = ({ className, ...props }: ComponentProps<typeof SelectItem>) => (
  <SelectItem className={cn(className)} {...props} />
)

export const PromptInputSelectValue = ({ className, ...props }: ComponentProps<typeof SelectValue>) => (
  <SelectValue className={cn(className)} {...props} />
)

// openDelay/closeDelay used to be forwarded here. Base UI's PreviewCard root has no such props
// (see PreviewCardRoot.d.ts) - they were being dropped on the floor, so the hover delay they were
// meant to set was never configured. Removed rather than kept as a promise the library ignores.
export const PromptInputHoverCard = (props: ComponentProps<typeof HoverCard>) => <HoverCard {...props} />

export const PromptInputHoverCardTrigger = (props: ComponentProps<typeof HoverCardTrigger>) => (
  <HoverCardTrigger {...props} />
)

export const PromptInputHoverCardContent = ({
  align = 'start',
  ...props
}: ComponentProps<typeof HoverCardContent>) => <HoverCardContent align={align} {...props} />

export const PromptInputTabsList = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn(className)} {...props} />
)

export const PromptInputTab = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn(className)} {...props} />
)

export const PromptInputTabLabel = ({ className, ...props }: ComponentProps<'h3'>) => (
  // Content provided via children in props
  // oxlint-disable-next-line eslint-plugin-jsx-a11y(heading-has-content)
  <h3 className={cn('mb-2 px-3 font-medium text-muted-foreground text-xs', className)} {...props} />
)

export const PromptInputTabBody = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('space-y-1', className)} {...props} />
)

export const PromptInputTabItem = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent', className)} {...props} />
)

export const PromptInputCommand = ({ className, ...props }: ComponentProps<typeof Command>) => (
  <Command className={cn(className)} {...props} />
)

export const PromptInputCommandInput = ({ className, ...props }: ComponentProps<typeof CommandInput>) => (
  <CommandInput className={cn(className)} {...props} />
)

export const PromptInputCommandList = ({ className, ...props }: ComponentProps<typeof CommandList>) => (
  <CommandList className={cn(className)} {...props} />
)

export const PromptInputCommandEmpty = ({ className, ...props }: ComponentProps<typeof CommandEmpty>) => (
  <CommandEmpty className={cn(className)} {...props} />
)

export const PromptInputCommandGroup = ({ className, ...props }: ComponentProps<typeof CommandGroup>) => (
  <CommandGroup className={cn(className)} {...props} />
)

export const PromptInputCommandItem = ({ className, ...props }: ComponentProps<typeof CommandItem>) => (
  <CommandItem className={cn(className)} {...props} />
)

export const PromptInputCommandSeparator = ({
  className,
  ...props
}: ComponentProps<typeof CommandSeparator>) => <CommandSeparator className={cn(className)} {...props} />

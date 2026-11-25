import type { ComponentProps } from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'
import { cn } from '@/lib/utils'
import { controlBase, numericText } from './control'

type InputProps = ComponentProps<typeof InputPrimitive> & {
  /** Mono tabular figures - prices, quantities, percentages. */
  numeric?: boolean
}

function Input({ className, type, numeric, ...props }: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        controlBase,
        'h-(--control-h) px-2 file:border-0 file:bg-transparent file:text-xs',
        numeric && numericText,
        className,
      )}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlBase, 'min-h-14 resize-y px-2 py-1.5 leading-relaxed', className)}
      {...props}
    />
  )
}

export { Input, Textarea }
export type { InputProps }

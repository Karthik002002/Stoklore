import { Controller } from 'react-hook-form'
import type { FieldError, FieldValues, Path, UseFormReturn } from 'react-hook-form'
import type { ComponentProps, ReactNode } from 'react'
import DatePicker from '@/components/DatePicker'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import TagInput from '@/components/TagInput'

// Thin react-hook-form bindings for this app's existing inputs. The base-ui primitives (Select,
// TagInput) are controlled-value components with no `ref`/`onBlur` for RHF to register, so they
// need Controller; plain <Input>/<Textarea> can use `register` directly and are wrapped here only
// so every form field renders its label and error the same way.
//
// Deliberately not a full form-component kit - just the field types the app's forms actually use,
// sharing one label/error shell.

/** Label + control + error message. The shell every field below renders into. */
/** What every field below needs: the form it belongs to, and which key on it. Generic over the
 *  form's own values, so `name` is checked against the schema rather than being any string. */
type FieldProps<T extends FieldValues> = {
  form: UseFormReturn<T>
  name: Path<T>
  label?: ReactNode
  hint?: ReactNode
  className?: string
}

export function Field({
  label,
  error,
  hint,
  children,
  className = '',
}: {
  label?: ReactNode
  error?: FieldError
  hint?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      {label && <label className="text-xs text-muted-foreground">{label}</label>}
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </div>
  )
}

/** Text/number input bound via register(). `type="number"` values stay strings - the zod schemas
 *  coerce them (see lib/schemas.js), so blank stays distinguishable from 0. */
export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  ...props
}: FieldProps<T> & Omit<ComponentProps<typeof Input>, 'form' | 'name'>) {
  const error = form.formState.errors[name] as FieldError | undefined
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <Input {...props} {...form.register(name)} aria-invalid={!!error} />
    </Field>
  )
}

export function TextAreaField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  ...props
}: FieldProps<T> & Omit<ComponentProps<typeof Textarea>, 'form' | 'name'>) {
  const error = form.formState.errors[name] as FieldError | undefined
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <Textarea {...props} {...form.register(name)} aria-invalid={!!error} />
    </Field>
  )
}

/** One option in a SelectField. */
export type SelectOption = { value: string; label: ReactNode; disabled?: boolean }

/** Select bound through Controller. `options` is [{value, label}]; `nullValue` maps a sentinel
 *  option back to null on the way out (base-ui renders '' as the placeholder, never as a
 *  selectable item - the same NO_ACCOUNT/ALL_ACCOUNTS trick the app already used by hand).
 *  `parse` converts the selected string before it reaches the form (e.g. Number for account ids),
 *  and `onSelect` fires after, for the "flip resultManual once the user picks" case. */
export function SelectField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  options,
  placeholder,
  nullValue,
  parse,
  onSelect,
  value: valueOverride,
  className,
  disabled,
}: FieldProps<T> & {
  options: SelectOption[]
  placeholder?: string
  /** The sentinel option that means "none" - mapped back to null on the way out. */
  nullValue?: string
  /** Converts the picked string before it reaches the form (Number, for account ids). */
  parse?: (value: string) => unknown
  onSelect?: (value: unknown) => void
  /** Overrides the field's own value, for the rare controlled-from-outside case. */
  value?: unknown
  disabled?: boolean
}) {
  const error = form.formState.errors[name] as FieldError | undefined
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => {
          const shown = valueOverride !== undefined ? valueOverride : field.value
          return (
            <Select
              disabled={disabled}
              value={shown == null ? (nullValue ?? '') : String(shown)}
              onValueChange={(raw) => {
                // Base UI types a select value as unknown; every option this form renders carries
                // a string, and `parse` is where a caller turns it into something else.
                const v = raw as string
                const next = nullValue != null && v === nullValue ? null : parse ? parse(v) : v
                field.onChange(next)
                onSelect?.(next)
              }}
            >
              <SelectTrigger className="w-full" onBlur={field.onBlur} aria-invalid={!!error}>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }}
      />
    </Field>
  )
}

export function TagField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  placeholder,
  className,
}: FieldProps<T> & { placeholder?: string }) {
  const error = form.formState.errors[name] as FieldError | undefined
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <TagInput value={field.value ?? []} onChange={field.onChange} placeholder={placeholder} />
        )}
      />
    </Field>
  )
}

/** A date field bound to react-hook-form. Controller rather than `register` for the same reason
 *  SelectField needs it: DatePicker is a controlled component with no ref or onBlur to register. */
export function DateField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  ...props
}: FieldProps<T> & Omit<ComponentProps<typeof DatePicker>, 'value' | 'onChange'>) {
  return (
    <Field
      label={label}
      hint={hint}
      error={form.formState.errors[name] as FieldError | undefined}
      className={className}
    >
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <DatePicker value={field.value} onChange={field.onChange} className="w-full" {...props} />
        )}
      />
    </Field>
  )
}

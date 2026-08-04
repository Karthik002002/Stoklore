import { Controller } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import TagInput from '@/components/TagInput'

// Thin react-hook-form bindings for this app's existing inputs. The base-ui primitives (Select,
// TagInput) are controlled-value components with no `ref`/`onBlur` for RHF to register, so they
// need Controller; plain <Input>/<Textarea> can use `register` directly and are wrapped here only
// so every form field renders its label and error the same way.
//
// Deliberately not a full form-component kit - just the four field types the app's forms actually
// use, sharing one label/error shell.

/** Label + control + error message. The shell every field below renders into. */
export function Field({ label, error, hint, children, className = '' }) {
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
export function TextField({ form, name, label, hint, className, ...props }) {
  const error = form.formState.errors[name]
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <Input {...props} {...form.register(name)} aria-invalid={!!error} />
    </Field>
  )
}

export function TextAreaField({ form, name, label, hint, className, ...props }) {
  const error = form.formState.errors[name]
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <Textarea {...props} {...form.register(name)} aria-invalid={!!error} />
    </Field>
  )
}

/** Select bound through Controller. `options` is [{value, label}]; `nullValue` maps a sentinel
 *  option back to null on the way out (base-ui renders '' as the placeholder, never as a
 *  selectable item - the same NO_ACCOUNT/ALL_ACCOUNTS trick the app already used by hand).
 *  `parse` converts the selected string before it reaches the form (e.g. Number for account ids),
 *  and `onSelect` fires after, for the "flip resultManual once the user picks" case. */
export function SelectField({
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
}) {
  const error = form.formState.errors[name]
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
              onValueChange={(v) => {
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

export function TagField({ form, name, label, hint, placeholder, className }) {
  const error = form.formState.errors[name]
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

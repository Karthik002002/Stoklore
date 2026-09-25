import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRoundIcon, LockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  AUTH_EXPIRED_EVENT,
  getAuthStatus,
  login as loginRequest,
  recoverAccount,
  setupAccount,
  unlock as unlockRequest,
} from '@/services/api'

// The app is wrapped in this. Three ways in, decided by what the backend says:
//
//   setup   no account yet          -> name + password + PIN, and the recovery code, once
//   unlock  this browser is trusted -> PIN only (a full login here in the last 48 hours)
//   login   anything else           -> password + PIN
//
// The gate is a convenience, not the security. The API refuses every request without a valid
// session cookie (app/main.py), so removing this component in devtools shows an empty shell, not
// data - the only arrangement worth having when the app can be put on a tunnel.

type Mode = 'setup' | 'unlock' | 'login' | 'recover'

function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  ...rest
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  hint?: string
  // `onChange`/`value`/`type` are this component's own, so the passthrough must not redeclare them.
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'>) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** Shown once, and never retrievable again - so it gets the whole screen rather than a toast. */
function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  return (
    <div className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-xl border">
          <KeyRoundIcon className="size-4" />
        </span>
        <div>
          <h1 className="text-sm font-semibold">Your recovery code</h1>
          <p className="text-xs text-muted-foreground">Shown once. Put it in your password manager.</p>
        </div>
      </div>
      <p className="rounded-lg border bg-muted/40 p-3 text-center font-mono text-sm tracking-wider select-all">
        {code}
      </p>
      <p className="text-xs text-muted-foreground">
        It's the only way back in if you forget both the password and the PIN while away from this machine.
        Anyone holding it can reset the login, so treat it like the password itself.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I've saved it somewhere safe
      </label>
      <Button className="w-full" disabled={!saved} onClick={onDone}>
        Continue
      </Button>
    </div>
  )
}

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['authStatus'],
    queryFn: getAuthStatus,
    retry: false,
    // The session can die while the tab sits open (idle timeout, or a sign-out elsewhere).
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })

  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showRecovery, setShowRecovery] = useState<string | null>(null)
  const [forced, setForced] = useState<Mode | null>(null)

  // Any 401 from anywhere in the app means the session is gone: re-check and put the gate back.
  useEffect(() => {
    const onExpired = () => queryClient.invalidateQueries({ queryKey: ['authStatus'] })
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [queryClient])

  const mode: Mode = forced ?? (!status?.configured ? 'setup' : status?.device_trusted ? 'unlock' : 'login')
  const pinLength = status?.pin_length ?? 6

  const clear = () => {
    setPassword('')
    setPin('')
    setCode('')
  }

  const onSignedIn = (recoveryCode?: string) => {
    clear()
    setError(null)
    setForced(null)
    if (recoveryCode) setShowRecovery(recoveryCode)
    // Everything fetched while signed out failed; start clean rather than showing stale errors.
    queryClient.clear()
    queryClient.invalidateQueries({ queryKey: ['authStatus'] })
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'setup') return setupAccount({ username: name, password, pin })
      if (mode === 'unlock') return unlockRequest(pin)
      if (mode === 'recover') return recoverAccount(code, password, pin)
      return loginRequest(password, pin)
    },
    onSuccess: (res) => onSignedIn((res as { recovery_code?: string }).recovery_code),
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
      clear() // never leave secrets in a failed form
      // Too many wrong PINs drops this browser's trust: re-read status so the password comes back.
      if (mode === 'unlock') queryClient.invalidateQueries({ queryKey: ['authStatus'] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-5" />
      </div>
    )
  }

  if (showRecovery) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <RecoveryCode code={showRecovery} onDone={() => setShowRecovery(null)} />
      </div>
    )
  }

  if (status?.authenticated) return <>{children}</>

  const ready =
    mode === 'unlock'
      ? pin.length >= pinLength
      : mode === 'recover'
        ? code.trim().length > 0 && password.length >= 8 && pin.length >= pinLength
        : mode === 'setup'
          ? name.trim().length > 0 && password.length >= 8 && pin.length >= pinLength
          : password.length > 0 && pin.length >= pinLength

  const title = {
    setup: 'Create your login',
    unlock: status?.username ? `Welcome back, ${status.username}` : 'Welcome back',
    login: 'Stoklore',
    recover: 'Use your recovery code',
  }[mode]

  const subtitle = {
    setup: 'One account, stored only on this machine',
    unlock: 'Enter your PIN to unlock',
    login: 'Password and PIN',
    recover: 'Sets a new password and PIN',
  }[mode]

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !submit.isPending) submit.mutate()
        }}
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl border">
            <LockIcon className="size-4" />
          </span>
          <div>
            <h1 className="text-sm font-semibold">{title}</h1>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        {mode === 'setup' && (
          <Field
            label="Your name"
            value={name}
            onChange={setName}
            autoFocus
            autoComplete="username"
            hint="A label for this account — it isn't asked for at sign-in"
          />
        )}

        {mode === 'recover' && (
          <Field
            label="Recovery code"
            value={code}
            onChange={setCode}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            className="font-mono"
          />
        )}

        {mode !== 'unlock' && (
          <Field
            label={mode === 'login' ? 'Password' : 'New password'}
            type="password"
            value={password}
            onChange={setPassword}
            autoFocus={mode === 'login'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            hint={mode === 'login' ? undefined : 'At least 8 characters'}
          />
        )}

        <Field
          label={mode === 'login' || mode === 'unlock' ? 'PIN' : 'New PIN'}
          type="password"
          value={pin}
          onChange={(v) => setPin(v.replace(/\D/g, ''))}
          autoFocus={mode === 'unlock'}
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          className="font-mono tracking-[0.3em]"
          hint={mode === 'login' || mode === 'unlock' ? undefined : `${pinLength}-12 digits`}
        />

        {error && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</p>
        )}

        <Button type="submit" className="w-full" disabled={!ready || submit.isPending}>
          {submit.isPending && <Spinner className="size-4" />}
          {
            { setup: 'Create account', unlock: 'Unlock', login: 'Sign in', recover: 'Reset and sign in' }[
              mode
            ]
          }
        </Button>

        {mode === 'unlock' && (
          <button
            type="button"
            className="w-full text-[11px] text-muted-foreground underline"
            onClick={() => {
              clear()
              setError(null)
              setForced('login')
            }}
          >
            Use my password instead
          </button>
        )}

        {(mode === 'login' || mode === 'recover') && (
          <div className="space-y-1.5 border-t pt-3 text-[11px] text-muted-foreground">
            {mode === 'login' ? (
              <>
                <p>Forgot it?</p>
                {status?.has_recovery_code && (
                  <button
                    type="button"
                    className="underline hover:text-foreground"
                    onClick={() => {
                      clear()
                      setError(null)
                      setForced('recover')
                    }}
                  >
                    Use a recovery code
                  </button>
                )}
                <p>
                  No code? The login can only be cleared from the machine running the app:{' '}
                  <code>python -m app.reset_login</code>. It keeps your trades — it just lets you set a new
                  password and PIN.
                </p>
              </>
            ) : (
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => {
                  clear()
                  setError(null)
                  setForced(null)
                }}
              >
                Back to sign in
              </button>
            )}
          </div>
        )}

        {mode === 'setup' && (
          <p className="text-[11px] text-muted-foreground">
            Set this up on the machine running the app — it can't be created through a tunnel. You'll get a
            recovery code next; there's no other way back in.
          </p>
        )}
        {mode === 'unlock' && (
          <p className="text-[11px] text-muted-foreground">
            This browser stays unlockable by PIN for 48 hours after a password sign-in. A few wrong PINs and
            it asks for the password again.
          </p>
        )}
      </form>
    </div>
  )
}

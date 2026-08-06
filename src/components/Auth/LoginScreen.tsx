import { useState } from 'react'
import { useStore } from '@/state/store'
import { createAccount, login } from '@/state/authPersistence'

type Mode = 'login' | 'signup'

/** The login gate shown before AppShell is reachable (see App.tsx). Email/password are
 * checked against the real backend over HTTP (src/lib/http/authApi.ts, base URL from .env's
 * VITE_SERVER_IP) — this component only owns the form state and the "remember me" checkbox;
 * see authPersistence.ts for what "remember me" actually persists locally. */
export function LoginScreen() {
  const setAuthSession = useStore((s) => s.setAuthSession)

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const result = mode === 'signup' ? await createAccount(email, password, remember) : await login(email, password, remember)
      if (!result.ok) {
        setError(result.message ?? 'Something went wrong.')
        return
      }
      setAuthSession(result.email ?? email.trim().toLowerCase())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-studio-bg px-4">
      <div className="studio-panel w-[380px] max-w-full p-6 flex flex-col gap-5">
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-4xl">👁️🖥️</span>
          <h1 className="text-xl font-semibold tracking-wide text-studio-accent">Kibo Studio</h1>
          <p className="text-xs text-studio-muted">{mode === 'signup' ? 'Create an account to get started' : 'Log in to continue'}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="studio-label">Email</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1.5 text-sm w-full"
              placeholder="you@example.com"
              disabled={busy}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="studio-label">Password</span>
            <input
              type="password"
              required
              minLength={mode === 'signup' ? 6 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1.5 text-sm w-full"
              placeholder="••••••••"
              disabled={busy}
            />
          </label>

          {mode === 'signup' && (
            <label className="flex flex-col gap-1">
              <span className="studio-label">Confirm password</span>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-studio-panel2 border border-studio-border rounded px-2 py-1.5 text-sm w-full"
                placeholder="••••••••"
                disabled={busy}
              />
            </label>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={busy} />
            <span className="text-xs text-studio-muted">Remember me on this device</span>
          </label>

          {error && <p className="text-xs text-studio-danger">{error}</p>}

          <button type="submit" className="studio-btn-primary w-full justify-center" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create Account' : 'Log In'}
          </button>
        </form>

        <div className="flex items-center gap-2 text-[11px] text-studio-muted">
          <div className="flex-1 h-px bg-studio-border" />
          <span>or</span>
          <div className="flex-1 h-px bg-studio-border" />
        </div>

        <button
          type="button"
          disabled
          title="Google sign-in requires connecting a backend service — not available in this local build."
          className="studio-btn w-full justify-center opacity-50 cursor-not-allowed flex items-center gap-2"
        >
          <span aria-hidden>🔵</span> Continue with Google
        </button>

        <button
          type="button"
          className="text-xs text-studio-muted hover:text-studio-text text-center underline underline-offset-2"
          onClick={() => {
            setError(null)
            setMode((m) => (m === 'signup' ? 'login' : 'signup'))
          }}
        >
          {mode === 'signup' ? 'Already have an account? Log in' : "Don't have an account? Create one"}
        </button>
      </div>
    </div>
  )
}

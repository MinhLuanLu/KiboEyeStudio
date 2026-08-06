import { hasElectron } from './persistence'
import { loginRequest, signupRequest } from '@/lib/http/authApi'

/** Login/signup credential checks go straight to the real backend over HTTP (see
 * src/lib/http/authApi.ts + .env's VITE_SERVER_IP). What lives here is purely local
 * "remember me" bookkeeping — which email last logged in successfully — so the app can skip
 * the login form on the next launch when the user opted in. In Electron this is a small JSON
 * file in the app's userData directory (see electron/main/index.ts); in the browser
 * dev-preview fallback (no window.kibo) it's a single localStorage key. Neither path stores or
 * checks a password — that's the server's job. */

export interface AuthStatus {
  sessionEmail: string | null
}

export interface AuthResult {
  ok: boolean
  email?: string
  message?: string
}

const AUTH_SESSION_KEY = 'kibo-eye-studio:auth-session'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function persistSession(email: string | null): Promise<void> {
  if (hasElectron()) {
    await window.kibo!.authSetSession(email)
    return
  }
  try {
    if (email) localStorage.setItem(AUTH_SESSION_KEY, email)
    else localStorage.removeItem(AUTH_SESSION_KEY)
  } catch {
    // Best-effort, matching persistence.ts's own localStorage-quota tolerance elsewhere.
  }
}

export async function getAuthStatus(): Promise<AuthStatus> {
  if (hasElectron()) return window.kibo!.authStatus()
  return { sessionEmail: localStorage.getItem(AUTH_SESSION_KEY) }
}

export async function createAccount(email: string, password: string, remember: boolean): Promise<AuthResult> {
  const norm = normalizeEmail(email)
  const res = await signupRequest(norm, password)
  if (!res.success) return { ok: false, message: res.message || 'Sign up failed.' }
  await persistSession(remember ? norm : null)
  return { ok: true, email: norm, message: res.message }
}

export async function login(email: string, password: string, remember: boolean): Promise<AuthResult> {
  const norm = normalizeEmail(email)
  const res = await loginRequest(norm, password)
  if (!res.success) return { ok: false, message: res.message || 'Login failed.' }
  await persistSession(remember ? norm : null)
  return { ok: true, email: norm, message: res.message }
}

export async function logout(): Promise<void> {
  await persistSession(null)
}

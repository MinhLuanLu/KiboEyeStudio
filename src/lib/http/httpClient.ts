/** Thin fetch wrapper for the login/signup backend — the one place that knows the server's
 * base URL (from .env's VITE_SERVER_IP, see the CSP comment in index.html for why that name
 * must also be reflected there) and the shared { success, message, data } envelope every
 * endpoint returns. Network/parse failures are caught here and folded into the same
 * ApiResponse shape (success: false) rather than thrown, so every call site can handle
 * "the request didn't work" uniformly instead of needing its own try/catch. */

export interface ApiResponse<T = string> {
  success: boolean
  message: string
  data: T
}

const SERVER_BASE_URL = (import.meta.env.VITE_SERVER_IP as string | undefined)?.replace(/\/+$/, '') || 'http://localhost:8080'

// A dropped/reset connection doesn't always reject fetch()'s promise promptly on every
// network stack — this bounds how long the login/signup form can show "Please wait…" before
// giving up and surfacing a real error instead of hanging indefinitely.
const REQUEST_TIMEOUT_MS = 12000

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return !!value && typeof value === 'object' && typeof (value as ApiResponse<unknown>).success === 'boolean'
}

export async function postJson<T = string>(path: string, body: unknown): Promise<ApiResponse<T>> {
  let res: Response
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    res = await fetch(`${SERVER_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'AbortError'
    return {
      success: false,
      message: timedOut ? `Timed out reaching the server at ${SERVER_BASE_URL}.` : `Could not reach the server at ${SERVER_BASE_URL}. Is it running?`,
      data: '' as T
    }
  } finally {
    clearTimeout(timeout)
  }

  const json: unknown = await res.json().catch(() => null)
  if (isApiResponse(json)) return json as ApiResponse<T>
  return { success: false, message: `Unexpected response from the server (HTTP ${res.status}).`, data: '' as T }
}

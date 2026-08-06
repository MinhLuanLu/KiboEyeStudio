import { postJson, type ApiResponse } from './httpClient'

export function loginRequest(email: string, password: string): Promise<ApiResponse> {
  return postJson('/api/login', { email, password })
}

export function signupRequest(email: string, password: string): Promise<ApiResponse> {
  return postJson('/api/signup', { email, password })
}

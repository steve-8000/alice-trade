import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'

const AUTH_FILE = resolve('data/auth/tokens.json')

export interface AuthToken {
  type: 'oauth' | 'api'
  provider: string      // 'anthropic' | 'openai' | 'google'
  access: string
  refresh?: string
  expires?: number       // unix ms
  email?: string
}

export interface AuthStore {
  [provider: string]: AuthToken
}

export async function loadAuthTokens(): Promise<AuthStore> {
  try {
    return JSON.parse(await readFile(AUTH_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export async function saveAuthToken(provider: string, token: AuthToken): Promise<void> {
  const store = await loadAuthTokens()
  store[provider] = token
  await mkdir(resolve('data/auth'), { recursive: true })
  await writeFile(AUTH_FILE, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
}

export async function removeAuthToken(provider: string): Promise<void> {
  const store = await loadAuthTokens()
  delete store[provider]
  await writeFile(AUTH_FILE, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
}

export function isTokenExpired(token: AuthToken): boolean {
  if (!token.expires) return false
  return Date.now() > token.expires - 60_000 // 1 minute buffer
}

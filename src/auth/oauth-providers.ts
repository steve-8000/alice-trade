import crypto from 'crypto'

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

export interface OAuthConfig {
  provider: string
  clientId: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  callbackPath: string
}

// Anthropic (Claude) OAuth — uses the same client as opencode/Claude Code
export const ANTHROPIC_OAUTH: OAuthConfig = {
  provider: 'anthropic',
  clientId: 'ab7a0372-34ca-4f42-8402-76a36c5e579c',
  authUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://claude.ai/oauth/token',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  callbackPath: '/api/auth/callback/anthropic',
}

// OpenAI (Codex) OAuth
export const OPENAI_OAUTH: OAuthConfig = {
  provider: 'openai',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authUrl: 'https://auth.openai.com/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  callbackPath: '/api/auth/callback/openai',
}

// Google (Gemini) OAuth — uses Google AI Studio OAuth
export const GEMINI_OAUTH: OAuthConfig = {
  provider: 'google',
  clientId: '936733894804-cd4g3ckndgna2iu64p1dmqeo0t4l2g1j.apps.googleusercontent.com',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/generative-language'],
  callbackPath: '/api/auth/callback/google',
}

export const OAUTH_PROVIDERS: Record<string, OAuthConfig> = {
  anthropic: ANTHROPIC_OAUTH,
  openai: OPENAI_OAUTH,
  google: GEMINI_OAUTH,
}

export interface OAuthSession {
  provider: string
  codeVerifier: string
  state: string
  createdAt: number
}

const pendingSessions = new Map<string, OAuthSession>()

export function startOAuthFlow(provider: string, baseUrl: string): { authUrl: string; state: string } {
  const config = OAUTH_PROVIDERS[provider]
  if (!config) throw new Error(`Unknown OAuth provider: ${provider}`)

  const { codeVerifier, codeChallenge } = generatePKCE()
  const state = generateState()

  pendingSessions.set(state, {
    provider,
    codeVerifier,
    state,
    createdAt: Date.now(),
  })

  // Clean old sessions (>10 min)
  for (const [key, session] of pendingSessions) {
    if (Date.now() - session.createdAt > 600_000) pendingSessions.delete(key)
  }

  const redirectUri = `${baseUrl}${config.callbackPath}`
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...(provider === 'openai' ? { audience: 'https://api.openai.com/v1' } : {}),
  })

  return {
    authUrl: `${config.authUrl}?${params.toString()}`,
    state,
  }
}

export function getPendingSession(state: string): OAuthSession | undefined {
  return pendingSessions.get(state)
}

export function clearPendingSession(state: string): void {
  pendingSessions.delete(state)
}

export async function exchangeCodeForTokens(
  provider: string,
  code: string,
  codeVerifier: string,
  baseUrl: string,
): Promise<{ access: string; refresh?: string; expires?: number }> {
  const config = OAUTH_PROVIDERS[provider]
  if (!config) throw new Error(`Unknown OAuth provider: ${provider}`)

  const redirectUri = `${baseUrl}${config.callbackPath}`

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${err}`)
  }

  const data = await res.json() as Record<string, unknown>

  return {
    access: (data.access_token as string) || '',
    refresh: (data.refresh_token as string) || undefined,
    expires: data.expires_in ? Date.now() + (data.expires_in as number) * 1000 : undefined,
  }
}

export async function refreshAccessToken(
  provider: string,
  refreshToken: string,
): Promise<{ access: string; refresh?: string; expires?: number }> {
  const config = OAUTH_PROVIDERS[provider]
  if (!config) throw new Error(`Unknown OAuth provider: ${provider}`)

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
  })

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`)
  }

  const data = await res.json() as Record<string, unknown>

  return {
    access: (data.access_token as string) || '',
    refresh: (data.refresh_token as string) || refreshToken,
    expires: data.expires_in ? Date.now() + (data.expires_in as number) * 1000 : undefined,
  }
}

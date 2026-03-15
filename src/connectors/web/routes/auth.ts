import { Hono } from 'hono'
import {
  loadAuthTokens,
  saveAuthToken,
  removeAuthToken,
  isTokenExpired,
  OAUTH_PROVIDERS,
  startOAuthFlow,
  getPendingSession,
  clearPendingSession,
  exchangeCodeForTokens,
  refreshAccessToken,
  loadRegisteredProviders,
  addRegisteredProvider,
  removeRegisteredProvider,
} from '../../../auth/index.js'
import type { AuthToken, RegisteredProvider } from '../../../auth/index.js'
import { writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'

export function createAuthRoutes() {
  const app = new Hono()

  // GET /api/auth/status — list authenticated providers
  app.get('/status', async (c) => {
    const tokens = await loadAuthTokens()
    const status: Record<string, { authenticated: boolean; expired: boolean; email?: string; provider: string }> = {}
    for (const [provider, token] of Object.entries(tokens)) {
      status[provider] = {
        authenticated: true,
        expired: isTokenExpired(token),
        email: token.email,
        provider: token.provider,
      }
    }
    // Also list available but not authenticated providers
    for (const provider of Object.keys(OAUTH_PROVIDERS)) {
      if (!status[provider]) {
        status[provider] = { authenticated: false, expired: false, provider }
      }
    }
    return c.json(status)
  })

  // POST /api/auth/login/:provider — start OAuth flow
  app.post('/login/:provider', async (c) => {
    const provider = c.req.param('provider')
    if (!OAUTH_PROVIDERS[provider]) {
      return c.json({ error: `Unknown provider: ${provider}` }, 400)
    }

    // Determine base URL from request
    const proto = c.req.header('x-forwarded-proto') || 'https'
    const host = c.req.header('x-forwarded-host') || c.req.header('host') || 'localhost:3002'
    const baseUrl = `${proto}://${host}`

    try {
      const { authUrl, state } = startOAuthFlow(provider, baseUrl)
      return c.json({ authUrl, state })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to start OAuth' }, 500)
    }
  })

  // GET /api/auth/callback/:provider — OAuth callback (browser redirect lands here)
  app.get('/callback/:provider', async (c) => {
    const provider = c.req.param('provider')
    const code = c.req.query('code')
    const state = c.req.query('state')
    const error = c.req.query('error')

    if (error) {
      return c.html(`<html><body><h2>Authentication Failed</h2><p>${error}</p><script>window.close()</script></body></html>`)
    }

    if (!code || !state) {
      return c.html('<html><body><h2>Invalid callback</h2><p>Missing code or state</p></body></html>', 400)
    }

    const session = getPendingSession(state)
    if (!session || session.provider !== provider) {
      return c.html('<html><body><h2>Invalid session</h2><p>OAuth session expired or invalid</p></body></html>', 400)
    }

    try {
      const proto = c.req.header('x-forwarded-proto') || 'https'
      const host = c.req.header('x-forwarded-host') || c.req.header('host') || 'localhost:3002'
      const baseUrl = `${proto}://${host}`

      const tokens = await exchangeCodeForTokens(provider, code, session.codeVerifier, baseUrl)
      clearPendingSession(state)

      const authToken: AuthToken = {
        type: 'oauth',
        provider,
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
      }

      await saveAuthToken(provider, authToken)

      // Return HTML that closes the popup and notifies the parent window
      return c.html(`
        <html><body>
          <h2>Authentication Successful!</h2>
          <p>${provider} connected. You can close this window.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'oauth-success', provider: '${provider}' }, '*');
              window.close();
            } else {
              setTimeout(() => window.location.href = '/settings', 2000);
            }
          </script>
        </body></html>
      `)
    } catch (err) {
      clearPendingSession(state)
      const msg = err instanceof Error ? err.message : 'Token exchange failed'
      return c.html(`<html><body><h2>Authentication Failed</h2><p>${msg}</p></body></html>`, 500)
    }
  })

  // POST /api/auth/refresh/:provider — manually refresh token
  app.post('/refresh/:provider', async (c) => {
    const provider = c.req.param('provider')
    const tokens = await loadAuthTokens()
    const token = tokens[provider]
    if (!token?.refresh) {
      return c.json({ error: 'No refresh token available' }, 400)
    }

    try {
      const refreshed = await refreshAccessToken(provider, token.refresh)
      const updated: AuthToken = {
        ...token,
        access: refreshed.access,
        refresh: refreshed.refresh || token.refresh,
        expires: refreshed.expires,
      }
      await saveAuthToken(provider, updated)
      return c.json({ success: true, expires: updated.expires })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Refresh failed' }, 500)
    }
  })

  // DELETE /api/auth/:provider — logout
  app.delete('/:provider', async (c) => {
    const provider = c.req.param('provider')
    await removeAuthToken(provider)
    return c.json({ success: true })
  })

  // POST /api/auth/import — import token from opencode auth.json or manual paste
  app.post('/import', async (c) => {
    const body = await c.req.json<{ provider: string; access: string; refresh?: string; expires?: number }>()
    const authToken: AuthToken = {
      type: 'oauth',
      provider: body.provider,
      access: body.access,
      refresh: body.refresh,
      expires: body.expires,
    }
    await saveAuthToken(body.provider, authToken)
    return c.json({ success: true })
  })

  // ==================== Provider Registry ====================

  // GET /api/auth/providers — list registered providers
  app.get('/providers', async (c) => {
    const providers = await loadRegisteredProviders()
    return c.json(providers)
  })

  // POST /api/auth/providers — add/update a provider
  app.post('/providers', async (c) => {
    const body = await c.req.json<RegisteredProvider>()
    if (!body.id) body.id = `${body.sdkProvider}-${Date.now().toString(36)}`
    await addRegisteredProvider(body)
    return c.json({ success: true, id: body.id })
  })

  // DELETE /api/auth/providers/:id — remove a provider
  app.delete('/providers/:id', async (c) => {
    const id = c.req.param('id')
    await removeRegisteredProvider(id)
    return c.json({ success: true })
  })

  // POST /api/auth/providers/:id/activate — set as active provider
  app.post('/providers/:id/activate', async (c) => {
    const id = c.req.param('id')
    const providers = await loadRegisteredProviders()
    const provider = providers.find(p => p.id === id)
    if (!provider) return c.json({ error: 'Provider not found' }, 404)

    const configDir = resolve('data/config')
    await mkdir(configDir, { recursive: true })
    // Resolve baseUrl
    let baseUrl = provider.baseUrl || undefined

    // OAuth tokens can't call provider APIs directly — they need clab-proxy bridge
    // If OAuth auth and no baseUrl, try the default clab-proxy
    if (provider.authType === 'oauth' && !baseUrl) {
      baseUrl = 'http://219.255.103.226:8317/v1'
    }

    // Ensure baseUrl ends with /v1 for OpenAI-compatible endpoints
    if (baseUrl && !baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.replace(/\/+$/, '') + '/v1'
    }

    // For OAuth providers going through clab-proxy, use the proxy API key
    const proxyApiKey = 'clp_dxRDlIjEJ2OHgsx6dMZdDtle4oCoJQTB'
    const apiKeys = provider.apiKey
      ? { [provider.sdkProvider]: provider.apiKey }
      : provider.authType === 'oauth'
        ? { [provider.sdkProvider]: proxyApiKey }
        : {}

    const aiConfig = {
      backend: 'vercel-ai-sdk',
      provider: provider.sdkProvider,
      model: provider.model,
      ...(baseUrl ? { baseUrl } : {}),
      apiKeys,
    }
    await writeFile(resolve(configDir, 'ai-provider-manager.json'), JSON.stringify(aiConfig, null, 2) + '\n')
    return c.json({ success: true, activeProvider: provider })
  })

  // GET /api/auth/models/:provider — fetch available models for a provider
  app.get('/models/:provider', async (c) => {
    const provider = c.req.param('provider')
    const tokens = await loadAuthTokens()
    const token = tokens[provider]

    // Hardcoded model lists per provider (official API doesn't always list all)
    const KNOWN_MODELS: Record<string, string[]> = {
      anthropic: [
        'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
        'claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250514',
      ],
      openai: [
        'gpt-5.3-codex-spark', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2',
        'gpt-5.1-codex', 'gpt-5.1', 'gpt-5-codex', 'gpt-5',
        'o4-mini', 'o3', 'gpt-4.1',
      ],
      google: [
        'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash',
        'gemini-3.1-pro-preview', 'gemini-3-flash-preview',
      ],
    }

    // Try to fetch live model list from API (OpenAI-compatible)
    if (token?.access) {
      try {
        const baseUrls: Record<string, string> = {
          openai: 'https://api.openai.com/v1',
          google: 'https://generativelanguage.googleapis.com/v1beta',
        }
        const baseUrl = baseUrls[provider]
        if (baseUrl && provider === 'openai') {
          const res = await fetch(`${baseUrl}/models`, {
            headers: { 'Authorization': `Bearer ${token.access}` },
          })
          if (res.ok) {
            const data = await res.json() as { data?: Array<{ id: string }> }
            if (data.data?.length) {
              return c.json({
                provider,
                source: 'live',
                models: data.data.map(m => m.id).sort(),
              })
            }
          }
        }
      } catch { /* fall through to known models */ }
    }

    // Also try querying clab-proxy if configured
    const proxyUrl = c.req.query('proxyUrl')
    const proxyKey = c.req.query('proxyKey')
    if (proxyUrl) {
      try {
        const headers: Record<string, string> = {}
        if (proxyKey) headers['Authorization'] = `Bearer ${proxyKey}`
        const res = await fetch(`${proxyUrl}/v1/models`, { headers })
        if (res.ok) {
          const data = await res.json() as { data?: Array<{ id: string }> }
          if (data.data?.length) {
            return c.json({
              provider,
              source: 'proxy',
              models: data.data.map(m => m.id).sort(),
            })
          }
        }
      } catch { /* fall through */ }
    }

    return c.json({
      provider,
      source: 'known',
      models: KNOWN_MODELS[provider] || [],
      authenticated: !!token?.access,
    })
  })

  return app
}

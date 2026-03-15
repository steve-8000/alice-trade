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
    const aiConfig = {
      backend: 'vercel-ai-sdk',
      provider: provider.sdkProvider,
      model: provider.model,
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
      apiKeys: provider.apiKey ? { [provider.sdkProvider]: provider.apiKey } : {},
    }
    await writeFile(resolve(configDir, 'ai-provider-manager.json'), JSON.stringify(aiConfig, null, 2) + '\n')
    return c.json({ success: true, activeProvider: provider })
  })

  return app
}

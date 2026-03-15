/**
 * Model factory — creates Vercel AI SDK LanguageModel instances from config.
 *
 * Reads ai-provider-manager.json from disk on each call so that model
 * changes take effect without a restart.  Uses dynamic imports so unused
 * provider packages don't prevent startup.
 */

import type { LanguageModel } from 'ai'
import { readAIProviderConfig } from '../../core/config.js'
import { loadAuthTokens, isTokenExpired, refreshAccessToken, saveAuthToken } from '../../auth/index.js'

/** Result includes the model plus a cache key for change detection. */
export interface ModelFromConfig {
  model: LanguageModel
  /** `provider:modelId:baseUrl` — use this to detect config changes. */
  key: string
}

/** Per-request model override (e.g. from a sub-channel's vercelAiSdk config). */
export interface ModelOverride {
  provider: string
  model: string
  baseUrl?: string
  apiKey?: string
}

export async function createModelFromConfig(override?: ModelOverride): Promise<ModelFromConfig> {
  // Resolve effective values: override takes precedence over global config
  const config = await readAIProviderConfig()
  const p = override?.provider ?? config.provider
  const m = override?.model ?? config.model
  const url = override?.baseUrl ?? config.baseUrl
  const key = `${p}:${m}:${url ?? ''}`

  // Resolve API key: override.apiKey > global config.apiKeys[provider] > OAuth token
  const resolveApiKey = async (provider: string): Promise<string | undefined> => {
    if (override?.apiKey) return override.apiKey
    const configKey = (config.apiKeys as Record<string, string | undefined>)[provider]
    if (configKey) return configKey

    // Fall back to OAuth tokens
    const tokens = await loadAuthTokens()
    const token = tokens[provider]
    if (token?.access) {
      // Auto-refresh if expired
      if (isTokenExpired(token) && token.refresh) {
        try {
          const refreshed = await refreshAccessToken(provider, token.refresh)
          const updated = { ...token, access: refreshed.access, refresh: refreshed.refresh || token.refresh, expires: refreshed.expires }
          await saveAuthToken(provider, updated)
          return updated.access
        } catch {
          return token.access // try with expired token
        }
      }
      return token.access
    }

    return url ? 'ollama' : undefined
  }

  switch (p) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      const client = createAnthropic({ apiKey: await resolveApiKey('anthropic'), baseURL: url || undefined })
      return { model: client(m), key }
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const apiKey = await resolveApiKey('openai')
      const client = createOpenAI({ apiKey, baseURL: url || undefined })
      return { model: client.chat(m), key }
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      const client = createGoogleGenerativeAI({ apiKey: await resolveApiKey('google'), baseURL: url || undefined })
      return { model: client(m), key }
    }
    default:
      throw new Error(`Unsupported model provider: "${p}". Supported: anthropic, openai, google`)
  }
}

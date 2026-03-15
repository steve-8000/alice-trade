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
      // For Ollama: use native /api/chat with think:false via a fetch wrapper
      const isOllama = url?.includes('11434')
      if (isOllama) {
        const ollamaBase = url!.replace(/\/v1\/?$/, '')
        const client = createOpenAI({ apiKey: apiKey || 'ollama', baseURL: url || undefined })
        const baseModel = client.chat(m)
        // Wrap doGenerate to inject think:false via Ollama's native API
        const wrappedModel = {
          ...baseModel,
          modelId: baseModel.modelId,
          provider: baseModel.provider,
          specificationVersion: baseModel.specificationVersion,
          defaultObjectGenerationMode: baseModel.defaultObjectGenerationMode,
          async doGenerate(options: any) {
            // Call Ollama native API with think:false
            const messages = options.prompt?.map((p: any) => {
              if (p.role === 'system') return { role: 'system', content: typeof p.content === 'string' ? p.content : p.content?.map((c: any) => c.text || '').join('') }
              if (p.role === 'user') return { role: 'user', content: typeof p.content === 'string' ? p.content : p.content?.map((c: any) => c.type === 'text' ? c.text : '').join('') }
              if (p.role === 'assistant') return { role: 'assistant', content: typeof p.content === 'string' ? p.content : p.content?.map((c: any) => c.type === 'text' ? c.text : c.type === 'tool-call' ? JSON.stringify(c) : '').join('') }
              return { role: p.role, content: '' }
            }) || []

            const body = { model: m, messages, stream: false, think: false, options: { num_ctx: 131072 } }
            const res = await fetch(`${ollamaBase}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
            if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
            const data = await res.json() as any
            const text = data.message?.content || ''
            return {
              text,
              finishReason: 'stop' as const,
              usage: { promptTokens: data.prompt_eval_count || 0, completionTokens: data.eval_count || 0 },
              rawCall: { rawPrompt: messages, rawSettings: body },
              warnings: [],
            }
          },
          async doStream(options: any) {
            // For streaming, fall back to base model (thinking will happen but content comes through)
            return baseModel.doStream(options)
          },
        } as any
        return { model: wrappedModel, key }
      }
      const client = createOpenAI({ apiKey, baseURL: url || undefined })
      return { model: client.chat(m, { reasoning: false }), key }
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

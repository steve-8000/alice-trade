import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'

const PROVIDERS_FILE = resolve('data/config/ai-providers.json')

export interface RegisteredProvider {
  id: string
  name: string
  sdkProvider: 'anthropic' | 'openai' | 'google'
  model: string
  authType: 'oauth' | 'apikey'
  apiKey?: string
  baseUrl?: string | null
}

export async function loadRegisteredProviders(): Promise<RegisteredProvider[]> {
  try {
    return JSON.parse(await readFile(PROVIDERS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export async function saveRegisteredProviders(providers: RegisteredProvider[]): Promise<void> {
  await mkdir(resolve('data/config'), { recursive: true })
  await writeFile(PROVIDERS_FILE, JSON.stringify(providers, null, 2) + '\n')
}

export async function addRegisteredProvider(provider: RegisteredProvider): Promise<void> {
  const providers = await loadRegisteredProviders()
  const idx = providers.findIndex(p => p.id === provider.id)
  if (idx >= 0) providers[idx] = provider
  else providers.push(provider)
  await saveRegisteredProviders(providers)
}

export async function removeRegisteredProvider(id: string): Promise<void> {
  const providers = await loadRegisteredProviders()
  await saveRegisteredProviders(providers.filter(p => p.id !== id))
}

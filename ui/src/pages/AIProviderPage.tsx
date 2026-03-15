import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { api, type AppConfig, type AIProviderConfig } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { Section, Field, inputClass } from '../components/form'
import { useAutoSave, type SaveStatus } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/StateViews'

// ==================== Constants ====================

const PROVIDER_MODELS: Record<string, { label: string; value: string }[]> = {
  anthropic: [
    { label: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
    { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
    { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
  ],
  openai: [
    { label: 'GPT-5.2 Pro', value: 'gpt-5.2-pro' },
    { label: 'GPT-5.2', value: 'gpt-5.2' },
    { label: 'GPT-5 Mini', value: 'gpt-5-mini' },
  ],
  google: [
    { label: 'Gemini 3.1 Pro', value: 'gemini-3.1-pro-preview' },
    { label: 'Gemini 3 Flash', value: 'gemini-3-flash-preview' },
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
  ],
}

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'custom', label: 'Custom' },
]

const SDK_FORMATS = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic Compatible' },
  { value: 'google', label: 'Google Compatible' },
]

function detectCustomMode(provider: string, model: string): boolean {
  const presets = PROVIDER_MODELS[provider]
  if (!presets) return true
  return !presets.some((p) => p.value === model)
}

// ==================== Types ====================

interface RegisteredProvider {
  id: string
  name: string
  sdkProvider: 'anthropic' | 'openai' | 'google'
  model: string
  authType: 'oauth' | 'apikey'
  apiKey?: string
  baseUrl?: string | null
}

interface AuthStatus {
  [provider: string]: {
    authenticated: boolean
    expired: boolean
    email?: string
    provider: string
  }
}

const OAUTH_PROVIDERS = [
  { id: 'anthropic', name: 'Claude', icon: 'A', color: 'bg-[#d97706]/15 text-[#d97706]' },
  { id: 'openai', name: 'ChatGPT', icon: 'G', color: 'bg-[#10a37f]/15 text-[#10a37f]' },
  { id: 'google', name: 'Gemini', icon: 'G', color: 'bg-[#4285f4]/15 text-[#4285f4]' },
]

// ==================== Provider Card ====================

function ProviderCard({ provider, isActive, onActivate, onDelete }: {
  provider: RegisteredProvider
  isActive: boolean
  onActivate: () => void
  onDelete: () => void
}) {
  const providerColors: Record<string, string> = {
    anthropic: 'border-[#d97706]/40 bg-[#d97706]/[0.06]',
    openai: 'border-[#10a37f]/40 bg-[#10a37f]/[0.06]',
    google: 'border-[#4285f4]/40 bg-[#4285f4]/[0.06]',
  }

  return (
    <div
      onClick={onActivate}
      className={`relative rounded-xl border px-4 py-3 cursor-pointer transition-all min-w-[160px] ${
        isActive
          ? (providerColors[provider.sdkProvider] || 'border-accent/40 bg-accent/[0.06]')
          : 'border-border hover:border-text-muted/30 bg-bg-secondary/50'
      }`}
    >
      {isActive && (
        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute top-2 right-8 w-5 h-5 rounded-full flex items-center justify-center text-text-muted/40 hover:text-red hover:bg-red/10 transition-colors cursor-pointer"
        title="Remove provider"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
      <div className="text-[13px] font-semibold text-text pr-14">{provider.name}</div>
      <div className="text-[11px] text-text-muted mt-0.5">{provider.model}</div>
      <div className="flex items-center gap-1.5 mt-1.5">
        <span className={`text-[9px] px-1.5 py-[1px] rounded font-medium ${
          provider.authType === 'oauth' ? 'bg-accent/15 text-accent' : 'bg-bg-tertiary text-text-muted'
        }`}>
          {provider.authType === 'oauth' ? 'OAuth' : 'API Key'}
        </span>
        {provider.baseUrl && (
          <span className="text-[9px] px-1.5 py-[1px] rounded font-medium bg-bg-tertiary text-text-muted">
            Proxy
          </span>
        )}
      </div>
    </div>
  )
}

// ==================== Add Provider Form ====================

function AddProviderForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [sdkProvider, setSdkProvider] = useState<'anthropic' | 'openai' | 'google'>('anthropic')
  const [model, setModel] = useState('')
  const [authType, setAuthType] = useState<'oauth' | 'apikey'>('oauth')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setName(''); setSdkProvider('anthropic'); setModel(''); setAuthType('oauth'); setApiKey(''); setBaseUrl('')
  }

  const handleSave = async () => {
    if (!name.trim() || !model.trim()) return
    setSaving(true)
    try {
      const provider: RegisteredProvider = {
        id: `${sdkProvider}-${Date.now().toString(36)}`,
        name: name.trim(),
        sdkProvider,
        model: model.trim(),
        authType,
        ...(authType === 'apikey' && apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseUrl } : { baseUrl: null }),
      }
      const res = await fetch('/api/auth/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provider),
      })
      if (!res.ok) throw new Error('Failed to save')
      reset()
      setOpen(false)
      onAdded()
    } catch { /* ignore */ }
    setSaving(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl border border-dashed border-border hover:border-accent/40 px-4 py-3 cursor-pointer transition-all min-w-[160px] flex flex-col items-center justify-center gap-1 text-text-muted hover:text-accent"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        <span className="text-[11px] font-medium">Add Provider</span>
      </button>
    )
  }

  return (
    <div className="border border-border rounded-xl p-4 bg-bg-secondary/50">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-semibold text-text">Add Provider</h4>
        <button onClick={() => { setOpen(false); reset() }} className="text-text-muted hover:text-text cursor-pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude (Browser)" />
        </Field>
        <Field label="SDK Provider">
          <select className={inputClass} value={sdkProvider} onChange={(e) => setSdkProvider(e.target.value as 'anthropic' | 'openai' | 'google')}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google</option>
          </select>
        </Field>
        <Field label="Model">
          <input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. claude-sonnet-4-6" />
        </Field>
        <Field label="Auth Type">
          <select className={inputClass} value={authType} onChange={(e) => setAuthType(e.target.value as 'oauth' | 'apikey')}>
            <option value="oauth">Browser Login (OAuth)</option>
            <option value="apikey">API Key</option>
          </select>
        </Field>
        {authType === 'apikey' && (
          <>
            <Field label="API Key">
              <input className={inputClass} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            </Field>
            <Field label="Base URL">
              <input className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Leave empty for official API" />
            </Field>
          </>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !model.trim()}
          className="bg-accent text-white rounded-lg px-4 py-1.5 text-[12px] font-semibold cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Add Provider'}
        </button>
      </div>
    </div>
  )
}

// ==================== Provider Selector ====================

function ProviderSelector({ aiProvider, onProviderChanged }: { aiProvider: AIProviderConfig; onProviderChanged: () => void }) {
  const [providers, setProviders] = useState<RegisteredProvider[]>([])
  const [activating, setActivating] = useState<string | null>(null)

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/auth/providers')
      if (res.ok) setProviders(await res.json())
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchProviders() }, [])

  const activeId = useMemo(() => {
    // Match current ai-provider-manager config to a registered provider
    return providers.find(p =>
      p.sdkProvider === aiProvider.provider &&
      p.model === aiProvider.model
    )?.id ?? null
  }, [providers, aiProvider.provider, aiProvider.model])

  const handleActivate = async (id: string) => {
    if (id === activeId) return
    setActivating(id)
    try {
      const res = await fetch(`/api/auth/providers/${id}/activate`, { method: 'POST' })
      if (res.ok) onProviderChanged()
    } catch { /* ignore */ }
    setActivating(null)
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/auth/providers/${id}`, { method: 'DELETE' })
      fetchProviders()
    } catch { /* ignore */ }
  }

  if (providers.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-[12px] text-text-muted/60">No providers registered yet. Add one to get started.</p>
        <AddProviderForm onAdded={fetchProviders} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 overflow-x-auto pb-1">
        {providers.map(p => (
          <ProviderCard
            key={p.id}
            provider={p}
            isActive={p.id === activeId}
            onActivate={() => handleActivate(p.id)}
            onDelete={() => handleDelete(p.id)}
          />
        ))}
        <AddProviderForm onAdded={fetchProviders} />
      </div>
      {activating && (
        <p className="text-[11px] text-accent animate-pulse">Switching provider...</p>
      )}
    </div>
  )
}

// ==================== OAuth Browser Auth ====================

function OAuthLoginSection({ onProviderChanged }: { onProviderChanged: () => void }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [importProvider, setImportProvider] = useState<string | null>(null)
  const [importAccess, setImportAccess] = useState('')
  const [importRefresh, setImportRefresh] = useState('')

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/auth/status')
      if (res.ok) setAuthStatus(await res.json())
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchStatus()
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'oauth-success') { fetchStatus(); onProviderChanged() }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleLogout = async (provider: string) => {
    try { await fetch(`/api/auth/${provider}`, { method: 'DELETE' }); fetchStatus(); onProviderChanged() } catch { /* */ }
  }

  const handleRefresh = async (provider: string) => {
    try { await fetch(`/api/auth/refresh/${provider}`, { method: 'POST' }); fetchStatus() } catch { /* */ }
  }

  const handleImport = async (provider: string) => {
    if (!importAccess.trim()) return
    setLoading(provider)
    try {
      const res = await fetch('/api/auth/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          access: importAccess.trim(),
          refresh: importRefresh.trim() || undefined,
          expires: Date.now() + 86400000, // 24h default
        }),
      })
      if (res.ok) { fetchStatus(); onProviderChanged(); setImportProvider(null); setImportAccess(''); setImportRefresh('') }
    } catch { /* */ }
    setLoading(null)
  }

  return (
    <div className="space-y-2">
      {OAUTH_PROVIDERS.map(p => {
        const status = authStatus[p.id]
        const isAuth = status?.authenticated
        const isExpired = status?.expired

        return (
          <div key={p.id}>
            <div className={`flex items-center justify-between rounded-xl px-4 py-3 border transition-colors ${
              isAuth && !isExpired ? 'border-green/20 bg-green/[0.04]'
                : isAuth && isExpired ? 'border-[#ffc342]/20 bg-[#ffc342]/[0.04]'
                : 'border-border bg-bg-secondary/50'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold ${p.color}`}>
                  {p.icon}
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-text">{p.name}</div>
                  <div className="text-[11px] text-text-muted">
                    {isAuth && !isExpired && <span className="text-green">Connected</span>}
                    {isAuth && isExpired && <span className="text-[#ffc342]">Token expired</span>}
                    {!isAuth && 'Not connected'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {isAuth && isExpired && (
                  <button onClick={() => handleRefresh(p.id)} className="border border-border rounded-lg px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-colors hover:bg-bg-tertiary text-text-muted">
                    Refresh
                  </button>
                )}
                {isAuth ? (
                  <button onClick={() => handleLogout(p.id)} className="border border-border rounded-lg px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-colors hover:bg-red/10 hover:text-red text-text-muted">
                    Logout
                  </button>
                ) : (
                  <button
                    onClick={() => setImportProvider(importProvider === p.id ? null : p.id)}
                    className="bg-accent text-white rounded-lg px-4 py-1.5 text-[11px] font-semibold cursor-pointer transition-opacity hover:opacity-85"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>

            {/* Import token form */}
            {importProvider === p.id && (
              <div className="mt-1 border border-border/60 rounded-xl p-3 bg-bg-secondary/30 space-y-2">
                <p className="text-[10px] text-text-muted leading-relaxed">
                  Paste your OAuth token from <code className="text-accent">opencode auth</code> or <code className="text-accent">~/.local/share/opencode/auth.json</code>
                </p>
                <input className={inputClass} value={importAccess} onChange={e => setImportAccess(e.target.value)} placeholder="Access token (sk-ant-oat... / eyJhbG...)" />
                <input className={inputClass} value={importRefresh} onChange={e => setImportRefresh(e.target.value)} placeholder="Refresh token (optional, for auto-renewal)" />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleImport(p.id)}
                    disabled={!importAccess.trim() || loading === p.id}
                    className="bg-accent text-white rounded-lg px-4 py-1.5 text-[11px] font-semibold cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50"
                  >
                    {loading === p.id ? 'Importing...' : 'Import Token'}
                  </button>
                  <button onClick={() => { setImportProvider(null); setImportAccess(''); setImportRefresh('') }} className="text-[11px] text-text-muted hover:text-text cursor-pointer">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <p className="text-[10px] text-text-muted/50 mt-1">
        Import OAuth tokens from opencode CLI. Run <code className="text-text-muted">opencode auth login</code> locally to authenticate.
      </p>
    </div>
  )
}

// ==================== Main Page ====================

export function AIProviderPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)

  const loadConfig = () => api.config.load().then(setConfig).catch(() => {})
  useEffect(() => { loadConfig() }, [])

  const handleBackendSwitch = useCallback(
    async (backend: string) => {
      try {
        await api.config.setBackend(backend)
        setConfig((c) => c ? { ...c, aiProvider: { ...c.aiProvider, backend } } : c)
      } catch { /* ignore */ }
    },
    [],
  )

  const [showBackend, setShowBackend] = useState(false)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="AI Provider" description="Register, manage, and switch between AI providers." />

      {config ? (
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
          <div className="max-w-[640px] space-y-5">
            {/* Provider Selector */}
            <Section id="providers" title="Providers" description="Registered AI providers. Click to activate.">
              <ProviderSelector aiProvider={config.aiProvider} onProviderChanged={loadConfig} />
            </Section>

            {/* Browser OAuth Login */}
            <Section
              id="browser-auth"
              title="Browser Login"
              description="Login with your browser account. Uses OAuth — no API keys needed."
            >
              <OAuthLoginSection onProviderChanged={loadConfig} />
            </Section>

            {/* Direct API (only for Vercel AI SDK) */}
            {config.aiProvider.backend === 'vercel-ai-sdk' && (
              <Section id="model" title="Direct API" description="Manual provider, model, and API key configuration.">
                <ModelForm aiProvider={config.aiProvider} />
              </Section>
            )}

            {/* Backend Switcher (collapsed) */}
            <div className="border border-border/60 rounded-xl bg-bg-secondary/50 p-4">
              <button
                onClick={() => setShowBackend(!showBackend)}
                className="flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors cursor-pointer w-full"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showBackend ? 'rotate-90' : ''}`}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span className="font-semibold uppercase tracking-wider text-[13px]">Backend</span>
                <span className="text-[11px] text-text-muted/60 ml-1 normal-case tracking-normal">
                  ({({ 'claude-code': 'Claude Code', 'vercel-ai-sdk': 'Vercel AI SDK', 'agent-sdk': 'Agent SDK' } as Record<string, string>)[config.aiProvider.backend] || config.aiProvider.backend})
                </span>
              </button>

              {showBackend && (
                <div className="mt-3">
                  <p className="text-[13px] text-text-muted/70 mb-3 leading-relaxed">Runtime switch between AI backends.</p>
                  <div className="flex border border-border rounded-[10px] overflow-hidden">
                    {(['claude-code', 'vercel-ai-sdk', 'agent-sdk'] as const).map((b, i) => (
                      <button
                        key={b}
                        onClick={() => handleBackendSwitch(b)}
                        className={`flex-1 py-2 px-3 text-[13px] font-medium transition-colors cursor-pointer ${
                          config.aiProvider.backend === b
                            ? 'bg-accent/15 text-accent'
                            : 'bg-bg text-text-muted hover:bg-bg-tertiary hover:text-text'
                        } ${i > 0 ? 'border-l border-border' : ''}`}
                      >
                        {{ 'claude-code': 'Claude Code', 'vercel-ai-sdk': 'Vercel AI SDK', 'agent-sdk': 'Agent SDK' }[b]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
      </div>
      ) : (
        <PageLoading />
      )}
    </div>
  )
}

// ==================== Model Form ====================

function ModelForm({ aiProvider }: { aiProvider: AIProviderConfig }) {
  const initCustom = detectCustomMode(aiProvider.provider || 'anthropic', aiProvider.model || '')
  const [uiProvider, setUiProvider] = useState(initCustom ? 'custom' : (aiProvider.provider || 'anthropic'))
  const [sdkProvider, setSdkProvider] = useState(aiProvider.provider || 'openai')
  const [model, setModel] = useState(aiProvider.model || '')
  const [customModel, setCustomModel] = useState(initCustom ? (aiProvider.model || '') : '')
  const [baseUrl, setBaseUrl] = useState(aiProvider.baseUrl || '')
  const [showKeys, setShowKeys] = useState(false)
  const [keys, setKeys] = useState({ anthropic: '', openai: '', google: '' })
  const [keySaveStatus, setKeySaveStatus] = useState<SaveStatus>('idle')
  const keySavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isCustomMode = uiProvider === 'custom'
  const effectiveProvider = isCustomMode ? sdkProvider : uiProvider
  const presets = PROVIDER_MODELS[uiProvider] || []
  const isCustomModelInStandard = !isCustomMode && model !== '' && !presets.some((p) => p.value === model)
  const effectiveModel = isCustomMode
    ? customModel
    : (isCustomModelInStandard ? customModel || model : model)

  const modelData = useMemo(
    () => ({
      ...aiProvider,
      provider: effectiveProvider,
      model: effectiveModel,
      ...(baseUrl ? { baseUrl } : { baseUrl: undefined }),
    }),
    [aiProvider, effectiveProvider, effectiveModel, baseUrl],
  )

  const saveModel = useCallback(async (data: Record<string, unknown>) => {
    await api.config.updateSection('aiProvider', data)
  }, [])

  const { status: modelStatus, retry: modelRetry } = useAutoSave({ data: modelData, save: saveModel })

  const keyStatus = useMemo(() => ({
    anthropic: !!aiProvider.apiKeys?.anthropic,
    openai: !!aiProvider.apiKeys?.openai,
    google: !!aiProvider.apiKeys?.google,
  }), [aiProvider.apiKeys])

  const [liveKeyStatus, setLiveKeyStatus] = useState(keyStatus)
  useEffect(() => setLiveKeyStatus(keyStatus), [keyStatus])
  useEffect(() => () => { if (keySavedTimer.current) clearTimeout(keySavedTimer.current) }, [])

  const handleProviderChange = (newUiProvider: string) => {
    setUiProvider(newUiProvider)
    setBaseUrl('')
    if (newUiProvider === 'custom') {
      setSdkProvider('openai'); setModel(''); setCustomModel('')
    } else {
      setSdkProvider(newUiProvider)
      const defaults = PROVIDER_MODELS[newUiProvider]
      if (defaults?.length) { setModel(defaults[0].value); setCustomModel('') }
      else { setModel('') }
    }
  }

  const handleModelSelect = (value: string) => {
    if (value === '__custom__') { setModel(''); setCustomModel('') }
    else { setModel(value); setCustomModel('') }
  }

  const handleSaveKeys = async () => {
    setKeySaveStatus('saving')
    try {
      const updatedKeys = { ...aiProvider.apiKeys }
      if (keys.anthropic) updatedKeys.anthropic = keys.anthropic
      if (keys.openai) updatedKeys.openai = keys.openai
      if (keys.google) updatedKeys.google = keys.google
      await api.config.updateSection('aiProvider', { ...aiProvider, apiKeys: updatedKeys })
      setLiveKeyStatus({ anthropic: !!updatedKeys.anthropic, openai: !!updatedKeys.openai, google: !!updatedKeys.google })
      setKeys({ anthropic: '', openai: '', google: '' })
      setKeySaveStatus('saved')
      if (keySavedTimer.current) clearTimeout(keySavedTimer.current)
      keySavedTimer.current = setTimeout(() => setKeySaveStatus('idle'), 2000)
    } catch { setKeySaveStatus('error') }
  }

  return (
    <>
      <Field label="Provider">
        <div className="flex border border-border rounded-[10px] overflow-hidden">
          {PROVIDERS.map((p, i) => (
            <button
              key={p.value}
              onClick={() => handleProviderChange(p.value)}
              className={`flex-1 py-2 px-3 text-[13px] font-medium transition-colors cursor-pointer ${
                uiProvider === p.value ? 'bg-accent/15 text-accent' : 'bg-bg text-text-muted hover:bg-bg-tertiary hover:text-text'
              } ${i > 0 ? 'border-l border-border' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      {isCustomMode && (
        <Field label="API Format">
          <select className={inputClass} value={sdkProvider} onChange={(e) => setSdkProvider(e.target.value)}>
            {SDK_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
      )}

      {!isCustomMode && (
        <Field label="Model">
          <select className={inputClass} value={isCustomModelInStandard || model === '' ? '__custom__' : model} onChange={(e) => handleModelSelect(e.target.value)}>
            {presets.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            <option value="__custom__">Custom...</option>
          </select>
        </Field>
      )}

      {(isCustomMode || isCustomModelInStandard || (!isCustomMode && model === '')) && (
        <Field label={isCustomMode ? 'Model ID' : 'Custom Model ID'}>
          <input className={inputClass} value={customModel || model} onChange={(e) => { setCustomModel(e.target.value); setModel(e.target.value) }} placeholder="e.g. gpt-4o, claude-3-opus" />
        </Field>
      )}

      <Field label="Base URL">
        <input className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Leave empty for official API" />
      </Field>

      <SaveIndicator status={modelStatus} onRetry={modelRetry} />

      <div className="mt-5 border-t border-border pt-4">
        <button onClick={() => setShowKeys(!showKeys)} className="flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors cursor-pointer">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showKeys ? 'rotate-90' : ''}`}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
          API Keys
          <span className="text-[11px] text-text-muted/60 ml-1">({Object.values(liveKeyStatus).filter(Boolean).length}/{Object.keys(liveKeyStatus).length} configured)</span>
        </button>

        {showKeys && (
          <div className="mt-3 space-y-3">
            {(isCustomMode ? SDK_FORMATS.filter((f) => f.value === sdkProvider) : PROVIDERS.filter((p) => p.value !== 'custom')).map((p) => (
              <Field key={p.value} label={`${p.label} API Key`}>
                <div className="relative">
                  <input className={inputClass} type="password" value={keys[p.value as keyof typeof keys] ?? ''} onChange={(e) => setKeys((k) => ({ ...k, [p.value]: e.target.value }))} placeholder={liveKeyStatus[p.value as keyof typeof liveKeyStatus] ? '(configured)' : 'Not configured'} />
                  {liveKeyStatus[p.value as keyof typeof liveKeyStatus] && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-green">active</span>}
                </div>
              </Field>
            ))}
            <div className="flex items-center gap-3">
              <button onClick={handleSaveKeys} disabled={keySaveStatus === 'saving'} className="bg-accent text-white rounded-[10px] px-4 py-2 text-[13px] font-medium cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50">Save Keys</button>
              <SaveIndicator status={keySaveStatus} onRetry={handleSaveKeys} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

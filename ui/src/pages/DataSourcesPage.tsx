import { useState, useEffect } from 'react'
import { api, type AppConfig, type NewsCollectorConfig, type NewsCollectorFeed } from '../api'
import { marketDataApi, type MarketDataConnection } from '../api/market-data'
import { SaveIndicator } from '../components/SaveIndicator'
import { Field, inputClass } from '../components/form'
import { Toggle } from '../components/Toggle'
import { useConfigPage } from '../hooks/useConfigPage'
import { PageHeader } from '../components/PageHeader'
import type { SaveStatus } from '../hooks/useAutoSave'

type OpenbbConfig = Record<string, unknown>

function combineStatus(a: SaveStatus, b: SaveStatus): SaveStatus {
  if (a === 'error' || b === 'error') return 'error'
  if (a === 'saving' || b === 'saving') return 'saving'
  if (a === 'saved' || b === 'saved') return 'saved'
  return 'idle'
}

// ==================== Real-time Market Data ====================

const ALL_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const

const statusColor: Record<string, string> = {
  connected: 'bg-green-500',
  syncing: 'bg-yellow-500',
  connecting: 'bg-yellow-500',
  error: 'bg-red-500',
  disconnected: 'bg-gray-400',
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '--'
  const date = new Date(dateStr)
  const now = Date.now()
  const diffMs = now - date.getTime()
  if (diffMs < 0) return 'just now'
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  return `${diffDays}d ago`
}

function MarketDataWSSection() {
  const [connections, setConnections] = useState<MarketDataConnection[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({
    exchange: 'binance',
    symbols: 'BTC/USDT',
    timeframes: ['1m', '1h'] as string[],
    historyDays: 30,
  })
  const [adding, setAdding] = useState(false)

  const fetchConnections = async () => {
    try {
      const data = await marketDataApi.getConnections()
      setConnections(data)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchConnections()
    const interval = setInterval(fetchConnections, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleAdd = async () => {
    setAdding(true)
    try {
      const symbols = addForm.symbols.split(',').map((s) => s.trim()).filter(Boolean)
      await marketDataApi.addConnection({
        exchange: addForm.exchange,
        symbols,
        timeframes: addForm.timeframes,
        historyDays: addForm.historyDays,
      })
      await fetchConnections()
      setShowAdd(false)
      setAddForm({ exchange: 'binance', symbols: 'BTC/USDT', timeframes: ['1m', '1h'], historyDays: 30 })
    } catch { /* ignore */ }
    setAdding(false)
  }

  const handleStart = async (id: string) => {
    try { await marketDataApi.startConnection(id); await fetchConnections() } catch { /* ignore */ }
  }

  const handleStop = async (id: string) => {
    try { await marketDataApi.stopConnection(id); await fetchConnections() } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    try { await marketDataApi.deleteConnection(id); await fetchConnections() } catch { /* ignore */ }
  }

  const toggleTimeframe = (tf: string) => {
    setAddForm((prev) => ({
      ...prev,
      timeframes: prev.timeframes.includes(tf)
        ? prev.timeframes.filter((t) => t !== tf)
        : [...prev.timeframes, tf],
    }))
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between bg-bg-secondary border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-text">Real-time Market Data</h3>
            {connections.length > 0 && (
              <span className="text-[10px] font-medium text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                {connections.length} connection{connections.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">Connect to exchange WebSocket for live OHLCV data</p>
        </div>
      </div>
      <div className="px-4 py-4">
        {/* Connections list */}
        {connections.length > 0 && (
          <div className="space-y-2 mb-4">
            {connections.map((conn) => (
              <div key={conn.id} className="border border-border rounded-lg px-3 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded-full uppercase">
                      {conn.exchange}
                    </span>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${statusColor[conn.status] || 'bg-gray-400'}`} />
                    <span className="text-[11px] text-text-muted capitalize">{conn.status}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {conn.status === 'disconnected' || conn.status === 'error' ? (
                      <button
                        onClick={() => handleStart(conn.id)}
                        className="border border-border rounded-md px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text text-text-muted"
                      >
                        Start
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStop(conn.id)}
                        className="border border-border rounded-md px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text text-text-muted"
                      >
                        Stop
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(conn.id)}
                      className="shrink-0 text-text-muted hover:text-red transition-colors p-1"
                      title="Delete connection"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div>
                    <span className="text-text-muted">Symbols: </span>
                    <span className="text-text">{conn.symbols.join(', ')}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Timeframes: </span>
                    <span className="text-text">{conn.timeframes.join(', ')}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">History: </span>
                    <span className="text-text">{conn.historyDays} days</span>
                  </div>
                  <div>
                    <span className="text-text-muted">First built: </span>
                    <span className="text-text">{formatRelativeTime(conn.firstBuilt)}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Last update: </span>
                    <span className="text-text">{formatRelativeTime(conn.lastUpdate)}</span>
                  </div>
                </div>

                {conn.error && (
                  <p className="text-[11px] text-red mt-1.5">{conn.error}</p>
                )}

                {/* Per-symbol candle counts */}
                {conn.data && Object.keys(conn.data).length > 0 && (
                  <div className="border-t border-border mt-2 pt-2">
                    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">Candle Data</p>
                    <div className="space-y-0.5">
                      {Object.entries(conn.data).map(([symbol, timeframes]) => (
                        <div key={symbol} className="text-[11px]">
                          <span className="text-text font-medium">{symbol}</span>
                          <span className="text-text-muted ml-1.5">
                            {Object.entries(timeframes)
                              .map(([tf, info]) => `${tf}: ${info.count}`)
                              .join(', ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {connections.length === 0 && !showAdd && (
          <p className="text-[12px] text-text-muted mb-3">No connections configured.</p>
        )}

        {/* Add connection form */}
        {showAdd ? (
          <div className="border border-border/60 rounded-lg p-3 space-y-2.5">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Add Connection</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-text-muted mb-0.5">Exchange</label>
                <select
                  className={inputClass}
                  value={addForm.exchange}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, exchange: e.target.value }))}
                >
                  <option value="binance">binance</option>
                  <option value="bybit">bybit</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-0.5">History (days)</label>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  value={addForm.historyDays}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, historyDays: Number(e.target.value) || 30 }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-0.5">Symbols (comma-separated)</label>
              <input
                className={inputClass}
                value={addForm.symbols}
                onChange={(e) => setAddForm((prev) => ({ ...prev, symbols: e.target.value }))}
                placeholder="BTC/USDT, ETH/USDT"
              />
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-1">Timeframes</label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_TIMEFRAMES.map((tf) => (
                  <label key={tf} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addForm.timeframes.includes(tf)}
                      onChange={() => toggleTimeframe(tf)}
                      className="accent-text"
                    />
                    <span className="text-[11px] text-text">{tf}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleAdd}
                disabled={adding || !addForm.symbols.trim() || addForm.timeframes.length === 0}
                className="border border-border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text text-text-muted disabled:opacity-40 disabled:cursor-default"
              >
                {adding ? 'Adding...' : 'Add'}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="text-[12px] text-text-muted hover:text-text transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="border border-border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text text-text-muted"
          >
            Add Connection
          </button>
        )}
      </div>
    </div>
  )
}

// ==================== Constants ====================

const PROVIDER_OPTIONS: Record<string, string[]> = {
  crypto: ['yfinance', 'fmp', 'tiingo'],
  newsWorld: ['fmp', 'benzinga', 'tiingo', 'biztoc', 'intrinio'],
}

const ASSET_LABELS: Record<string, string> = {
  crypto: 'Crypto',
  newsWorld: 'News (World)',
}

/** Maps provider name → providerKeys key. null means free, no key required. */
const PROVIDER_KEY_MAP: Record<string, string | null> = {
  yfinance: null,
  fmp: 'fmp',
  intrinio: 'intrinio',
  tiingo: 'tiingo',
  alpha_vantage: 'alpha_vantage',
  benzinga: 'benzinga',
  biztoc: 'biztoc',
}

/** Macro/utility providers used by dedicated endpoints (not per-asset-class selectable) */
const UTILITY_PROVIDERS: ReadonlyArray<{ key: string; name: string; desc: string; hint: string }> = []

// ==================== Zone ====================

interface ZoneProps {
  title: string
  subtitle: string
  badge?: string
  enabled: boolean
  onToggle: () => void
  children: React.ReactNode
}

function Zone({ title, subtitle, badge, enabled, onToggle, children }: ZoneProps) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between bg-bg-secondary border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-text">{title}</h3>
            {badge && (
              <span className="text-[10px] font-medium text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                {badge}
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">{subtitle}</p>
        </div>
        <Toggle size="sm" checked={enabled} onChange={onToggle} />
      </div>
      <div className={enabled ? 'px-4 py-4' : 'px-4 py-4 opacity-40 pointer-events-none'}>
        {children}
      </div>
    </div>
  )
}

// ==================== Market Data Engine ====================

interface AssetProviderGridProps {
  providers: Record<string, string>
  providerKeys: Record<string, string>
  onProviderChange: (asset: string, provider: string) => void
  onKeyChange: (keyName: string, value: string) => void
}

function AssetProviderGrid({ providers, providerKeys, onProviderChange, onKeyChange }: AssetProviderGridProps) {
  const [localKeys, setLocalKeys] = useState<Record<string, string>>(() => ({ ...providerKeys }))
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({})

  const handleKeyChange = (keyName: string, value: string) => {
    setLocalKeys((prev) => ({ ...prev, [keyName]: value }))
    setTestStatus((prev) => ({ ...prev, [keyName]: 'idle' }))
    onKeyChange(keyName, value)
  }

  const testProvider = async (provider: string, keyName: string) => {
    const key = localKeys[keyName]
    if (!key) return
    setTestStatus((prev) => ({ ...prev, [keyName]: 'testing' }))
    try {
      const result = await api.openbb.testProvider(provider, key)
      setTestStatus((prev) => ({ ...prev, [keyName]: result.ok ? 'ok' : 'error' }))
    } catch {
      setTestStatus((prev) => ({ ...prev, [keyName]: 'error' }))
    }
  }

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-2">
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-3">Asset Providers</p>
      {Object.entries(PROVIDER_OPTIONS).map(([asset, options]) => {
        const selectedProvider = providers[asset] || options[0]
        const keyName = PROVIDER_KEY_MAP[selectedProvider] ?? null
        const status = keyName ? (testStatus[keyName] || 'idle') : 'idle'

        return (
          <div key={asset} className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted w-28 shrink-0">{ASSET_LABELS[asset]}</span>
            <select
              className={inputClass}
              value={selectedProvider}
              onChange={(e) => onProviderChange(asset, e.target.value)}
            >
              {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            {keyName ? (
              <>
                <input
                  className={inputClass}
                  type="password"
                  value={localKeys[keyName] || ''}
                  onChange={(e) => handleKeyChange(keyName, e.target.value)}
                  placeholder="API key"
                />
                <button
                  onClick={() => testProvider(selectedProvider, keyName)}
                  disabled={!localKeys[keyName] || status === 'testing'}
                  className={`shrink-0 border rounded-md px-3 py-2 text-[12px] font-medium cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${
                    status === 'ok'
                      ? 'border-green text-green'
                      : status === 'error'
                        ? 'border-red text-red'
                        : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
                  }`}
                >
                  {status === 'testing' ? '…' : status === 'ok' ? 'OK' : status === 'error' ? 'Fail' : 'Test'}
                </button>
              </>
            ) : (
              <span className="text-[11px] text-text-muted/50 px-2.5">Free</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface UtilityProvidersSectionProps {
  providerKeys: Record<string, string>
  onKeyChange: (keyName: string, value: string) => void
}

function UtilityProvidersSection({ providerKeys, onKeyChange }: UtilityProvidersSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [localKeys, setLocalKeys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const p of UTILITY_PROVIDERS) init[p.key] = providerKeys[p.key] || ''
    return init
  })
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({})

  const configuredCount = Object.values(localKeys).filter(Boolean).length

  const handleKeyChange = (keyName: string, value: string) => {
    setLocalKeys((prev) => ({ ...prev, [keyName]: value }))
    setTestStatus((prev) => ({ ...prev, [keyName]: 'idle' }))
    onKeyChange(keyName, value)
  }

  const testProvider = async (keyName: string) => {
    const key = localKeys[keyName]
    if (!key) return
    setTestStatus((prev) => ({ ...prev, [keyName]: 'testing' }))
    try {
      const result = await api.openbb.testProvider(keyName, key)
      setTestStatus((prev) => ({ ...prev, [keyName]: result.ok ? 'ok' : 'error' }))
    } catch {
      setTestStatus((prev) => ({ ...prev, [keyName]: 'error' }))
    }
  }

  return (
    <div className="border-t border-border pt-4 mt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-[12px] text-text-muted hover:text-text transition-colors w-full"
      >
        <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span className="font-semibold uppercase tracking-wide">Macro & Utility Providers</span>
        <span className="text-[11px] ml-auto">
          {configuredCount > 0 ? `${configuredCount} configured` : 'None configured'}
        </span>
      </button>
      {expanded && (
        <div className="mt-3">
          <p className="text-[12px] text-text-muted mb-3">
            Used by dedicated macro endpoints (FRED for CPI/GDP, BLS for employment, EIA for energy). Not per-asset-class selectable.
          </p>
          <div className="space-y-3">
            {UTILITY_PROVIDERS.map(({ key, name, desc, hint }) => {
              const status = testStatus[key] || 'idle'
              return (
                <Field key={key} label={name}>
                  <p className="text-[11px] text-text-muted mb-0.5">{desc}</p>
                  <p className="text-[10px] text-text-muted/60 mb-1.5">{hint}</p>
                  <div className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      type="password"
                      value={localKeys[key]}
                      onChange={(e) => handleKeyChange(key, e.target.value)}
                      placeholder="Not configured"
                    />
                    <button
                      onClick={() => testProvider(key)}
                      disabled={!localKeys[key] || status === 'testing'}
                      className={`shrink-0 border rounded-md px-3 py-2 text-[12px] font-medium cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${
                        status === 'ok'
                          ? 'border-green text-green'
                          : status === 'error'
                            ? 'border-red text-red'
                            : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
                      }`}
                    >
                      {status === 'testing' ? '…' : status === 'ok' ? 'OK' : status === 'error' ? 'Fail' : 'Test'}
                    </button>
                  </div>
                </Field>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface MarketDataZoneProps {
  openbb: OpenbbConfig
  enabled: boolean
  onToggle: () => void
  onChange: (patch: Partial<OpenbbConfig>) => void
  onChangeImmediate: (patch: Partial<OpenbbConfig>) => void
}

function MarketDataZone({ openbb, enabled, onToggle, onChange, onChangeImmediate }: MarketDataZoneProps) {
  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  const dataBackend = (openbb.dataBackend as string) || 'sdk'
  const apiUrl = (openbb.apiUrl as string) || 'http://localhost:6900'
  const apiServer = (openbb.apiServer as { enabled: boolean; port: number } | undefined) ?? { enabled: false, port: 6901 }
  const providers = (openbb.providers ?? {
    equity: 'yfinance', crypto: 'yfinance', currency: 'yfinance', newsCompany: 'yfinance', newsWorld: 'fmp',
  }) as Record<string, string>
  const providerKeys = (openbb.providerKeys ?? {}) as Record<string, string>

  const testConnection = async () => {
    setTesting(true)
    setTestStatus('idle')
    try {
      const res = await fetch(`${apiUrl}/api/v1/equity/search?query=AAPL&provider=sec`, { signal: AbortSignal.timeout(5000) })
      setTestStatus(res.ok ? 'ok' : 'error')
    } catch {
      setTestStatus('error')
    } finally {
      setTesting(false)
    }
  }

  const handleProviderChange = (asset: string, provider: string) => {
    onChangeImmediate({ providers: { ...providers, [asset]: provider } })
  }

  const handleKeyChange = (keyName: string, value: string) => {
    const all = (openbb.providerKeys ?? {}) as Record<string, string>
    const updated = { ...all, [keyName]: value }
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(updated)) {
      if (v) cleaned[k] = v
    }
    onChange({ providerKeys: cleaned })
  }

  return (
    <Zone
      title="Market Data Engine"
      subtitle="Structured financial data via OpenBB — configure once per asset class."
      enabled={enabled}
      onToggle={onToggle}
    >
      {/* Backend selector */}
      <div>
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Data Backend</p>
        <div className="flex border border-border rounded-lg overflow-hidden w-fit">
          {(['sdk', 'openbb'] as const).map((backend, i) => (
            <button
              key={backend}
              onClick={() => { onChangeImmediate({ dataBackend: backend }); setTestStatus('idle') }}
              className={`px-4 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                i > 0 ? 'border-l border-border' : ''
              } ${
                dataBackend === backend
                  ? 'bg-bg-tertiary text-text'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {backend === 'sdk' ? 'Internal SDK' : 'External OpenBB'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-1.5">
          {dataBackend === 'sdk'
            ? 'Uses the built-in TypeScript OpenBB engine. No external process required.'
            : 'Connects to an external OpenBB HTTP server (Python sidecar or custom).'}
        </p>
      </div>

      {/* Connection — only shown for external OpenBB backend */}
      {dataBackend === 'openbb' && (
        <div className="border-t border-border pt-4 mt-2">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Connection</p>
          <div className="flex items-center gap-2">
            <input
              className={`${inputClass} flex-1`}
              value={apiUrl}
              onChange={(e) => { onChange({ apiUrl: e.target.value }); setTestStatus('idle') }}
              placeholder="http://localhost:6900"
            />
            <button
              onClick={testConnection}
              disabled={testing}
              className={`shrink-0 border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors disabled:opacity-50 ${
                testStatus === 'ok'
                  ? 'border-green text-green'
                  : testStatus === 'error'
                    ? 'border-red text-red'
                    : 'border-border text-text-muted hover:bg-bg-tertiary hover:text-text'
              }`}
            >
              {testing ? 'Testing…' : testStatus === 'ok' ? 'Connected' : testStatus === 'error' ? 'Failed' : 'Test Connection'}
            </button>
            {testStatus !== 'idle' && (
              <div className={`w-2 h-2 rounded-full shrink-0 ${testStatus === 'ok' ? 'bg-green' : 'bg-red'}`} />
            )}
          </div>
        </div>
      )}

      {/* Asset providers + inline keys */}
      <AssetProviderGrid
        providers={providers}
        providerKeys={providerKeys}
        onProviderChange={handleProviderChange}
        onKeyChange={handleKeyChange}
      />

      {/* Embedded API server */}
      <div className="border-t border-border pt-4 mt-2">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Embedded API Server</p>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-[13px] text-text">Expose OpenBB HTTP API</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Start an OpenBB-compatible HTTP server at Alice startup. Other services can connect to{' '}
              <span className="font-mono text-[10px]">http://localhost:{apiServer.port}</span>.
            </p>
            {apiServer.enabled && (
              <div className="flex items-center gap-2 mt-2">
                <label className="text-[11px] text-text-muted shrink-0">Port</label>
                <input
                  className={`${inputClass} w-24`}
                  type="number"
                  min={1024}
                  max={65535}
                  value={apiServer.port}
                  onChange={(e) => onChange({ apiServer: { ...apiServer, port: Number(e.target.value) || 6901 } })}
                />
              </div>
            )}
          </div>
          <Toggle
            size="sm"
            checked={apiServer.enabled}
            onChange={(v) => onChangeImmediate({ apiServer: { ...apiServer, enabled: v } })}
          />
        </div>
      </div>

      {/* Utility/macro providers */}
      <UtilityProvidersSection
        providerKeys={providerKeys}
        onKeyChange={handleKeyChange}
      />
    </Zone>
  )
}

// ==================== Open Intelligence ====================

function FeedsSection({
  feeds,
  onChange,
}: {
  feeds: NewsCollectorFeed[]
  onChange: (feeds: NewsCollectorFeed[]) => void
}) {
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newSource, setNewSource] = useState('')

  const removeFeed = (index: number) => onChange(feeds.filter((_, i) => i !== index))

  const addFeed = () => {
    if (!newName.trim() || !newUrl.trim() || !newSource.trim()) return
    onChange([...feeds, { name: newName.trim(), url: newUrl.trim(), source: newSource.trim() }])
    setNewName('')
    setNewUrl('')
    setNewSource('')
  }

  return (
    <div>
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">RSS Feeds</p>
      <p className="text-[11px] text-text-muted mb-3">
        Collected articles are searchable via globNews / grepNews / readNews. Changes take effect on the next fetch cycle.
      </p>

      {/* Existing feeds */}
      {feeds.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {feeds.map((feed, i) => (
            <div
              key={`${feed.source}-${i}`}
              className="flex items-center gap-3 border border-border rounded-lg px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-text truncate">{feed.name}</p>
                <p className="text-[11px] text-text-muted truncate">{feed.url}</p>
                <p className="text-[10px] text-text-muted/60 mt-0.5">source: {feed.source}</p>
              </div>
              <button
                onClick={() => removeFeed(i)}
                className="shrink-0 text-text-muted hover:text-red transition-colors p-1"
                title="Remove feed"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {feeds.length === 0 && (
        <p className="text-[12px] text-text-muted mb-3">No feeds configured.</p>
      )}

      {/* Add feed form */}
      <div className="border border-border/60 rounded-lg p-3 space-y-2">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Add Feed</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">Name</label>
            <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. CoinDesk" />
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-0.5">Source Tag</label>
            <input className={inputClass} value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="e.g. coindesk" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-0.5">Feed URL</label>
          <input className={inputClass} value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://example.com/rss.xml" />
        </div>
        <button
          onClick={addFeed}
          disabled={!newName.trim() || !newUrl.trim() || !newSource.trim()}
          className="border border-border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text text-text-muted disabled:opacity-40 disabled:cursor-default"
        >
          Add Feed
        </button>
      </div>
    </div>
  )
}

interface CompactNewsSettingsProps {
  config: NewsCollectorConfig
  onChange: (patch: Partial<NewsCollectorConfig>) => void
  onChangeImmediate: (patch: Partial<NewsCollectorConfig>) => void
}

function CompactNewsSettings({ config, onChange, onChangeImmediate }: CompactNewsSettingsProps) {
  return (
    <div className="border-t border-border pt-4 mt-4">
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-3">Settings</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[11px] text-text-muted mb-0.5">Fetch interval (min)</label>
          <input
            className={inputClass}
            type="number"
            min={1}
            value={config.intervalMinutes}
            onChange={(e) => onChange({ intervalMinutes: Number(e.target.value) || 10 })}
          />
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-0.5">Retention (days)</label>
          <input
            className={inputClass}
            type="number"
            min={1}
            value={config.retentionDays}
            onChange={(e) => onChange({ retentionDays: Number(e.target.value) || 7 })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex-1 mr-3">
          <span className="text-[13px] text-text">Piggyback OpenBB</span>
          <p className="text-[11px] text-text-muted mt-0.5">
            Capture results from newsGetWorld / newsGetCompany into the news store.
          </p>
        </div>
        <Toggle size="sm" checked={config.piggybackOpenBB} onChange={(v) => onChangeImmediate({ piggybackOpenBB: v })} />
      </div>
    </div>
  )
}

interface OpenIntelligenceZoneProps {
  config: NewsCollectorConfig
  enabled: boolean
  onToggle: () => void
  onChange: (patch: Partial<NewsCollectorConfig>) => void
  onChangeImmediate: (patch: Partial<NewsCollectorConfig>) => void
}

function OpenIntelligenceZone({ config, enabled, onToggle, onChange, onChangeImmediate }: OpenIntelligenceZoneProps) {
  const badge = config.feeds.length > 0 ? `${config.feeds.length} feeds` : undefined

  return (
    <Zone
      title="Open Intelligence"
      subtitle="Accumulative news & feed store — keep adding sources, let AI do the mining."
      badge={badge}
      enabled={enabled}
      onToggle={onToggle}
    >
      <FeedsSection
        feeds={config.feeds}
        onChange={(feeds) => onChangeImmediate({ feeds })}
      />
      <CompactNewsSettings
        config={config}
        onChange={onChange}
        onChangeImmediate={onChangeImmediate}
      />
    </Zone>
  )
}

// ==================== Page ====================

const DEFAULT_NEWS_CONFIG: NewsCollectorConfig = {
  enabled: true,
  intervalMinutes: 10,
  maxInMemory: 2000,
  retentionDays: 7,
  piggybackOpenBB: true,
  feeds: [],
}

export function DataSourcesPage() {
  const openbb = useConfigPage<OpenbbConfig>({
    section: 'openbb',
    extract: (full: AppConfig) => (full as Record<string, unknown>).openbb as OpenbbConfig,
  })

  const news = useConfigPage<NewsCollectorConfig>({
    section: 'newsCollector',
    extract: (full: AppConfig) => (full as Record<string, unknown>).newsCollector as NewsCollectorConfig,
  })

  const status = combineStatus(openbb.status, news.status)
  const loadError = openbb.loadError || news.loadError
  const retry = () => { openbb.retry(); news.retry() }

  const openbbEnabled = !openbb.config || (openbb.config as Record<string, unknown>).enabled !== false
  const newsEnabled = !news.config || news.config.enabled !== false

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Data Sources"
        description="Market data and news feed configuration."
        right={<SaveIndicator status={status} onRetry={retry} />}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[640px] space-y-6">
          {/* Real-time Market Data zone */}
          <MarketDataWSSection />

          {/* Market Data Engine zone */}
          {openbb.config ? (
            <MarketDataZone
              openbb={openbb.config}
              enabled={openbbEnabled}
              onToggle={() => openbb.updateConfigImmediate({ enabled: !openbbEnabled } as Partial<OpenbbConfig>)}
              onChange={openbb.updateConfig}
              onChangeImmediate={openbb.updateConfigImmediate}
            />
          ) : (
            <Zone
              title="Market Data Engine"
              subtitle="Structured financial data via OpenBB — configure once per asset class."
              enabled={true}
              onToggle={() => {}}
            >
              <p className="text-[12px] text-text-muted">Loading…</p>
            </Zone>
          )}

          {/* Open Intelligence zone */}
          {news.config ? (
            <OpenIntelligenceZone
              config={news.config}
              enabled={newsEnabled}
              onToggle={() => news.updateConfigImmediate({ enabled: !newsEnabled })}
              onChange={news.updateConfig}
              onChangeImmediate={news.updateConfigImmediate}
            />
          ) : (
            <Zone
              title="Open Intelligence"
              subtitle="Accumulative news & feed store — keep adding sources, let AI do the mining."
              enabled={true}
              onToggle={() => {}}
            >
              <p className="text-[12px] text-text-muted">Loading…</p>
            </Zone>
          )}
        </div>
        {loadError && <p className="text-[13px] text-red mt-4">Failed to load configuration.</p>}
      </div>
    </div>
  )
}

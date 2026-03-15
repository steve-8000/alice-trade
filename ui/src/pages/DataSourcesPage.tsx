import { useState, useEffect } from 'react'
import { marketDataApi, type MarketDataConnection } from '../api/market-data'
import { inputClass } from '../components/form'
import { PageHeader } from '../components/PageHeader'

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

  const handleRemoveSymbol = async (connectionId: string, symbol: string) => {
    try { await marketDataApi.removeSymbol(connectionId, symbol); await fetchConnections() } catch { /* ignore */ }
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
                        <div key={symbol} className="text-[11px] flex items-center gap-1 group">
                          <span className="text-text font-medium">{symbol}</span>
                          <span className="text-text-muted ml-1.5">
                            {Object.entries(timeframes)
                              .map(([tf, info]) => `${tf}: ${info.count}`)
                              .join(', ')}
                          </span>
                          <button
                            onClick={() => handleRemoveSymbol(conn.id, symbol)}
                            className="opacity-0 group-hover:opacity-100 ml-1 text-text-muted hover:text-red transition-all shrink-0"
                            title={`Remove ${symbol}`}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
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
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">{'\uC2EC\uBCFC \uCD94\uAC00'}</p>
            {connections.some(c => c.exchange === addForm.exchange) && (
              <p className="text-[10px] text-text-muted mb-1">
                Existing {addForm.exchange} connection found — new symbols will be merged.
              </p>
            )}
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
                {adding ? 'Adding...' : '\uC2EC\uBCFC \uCD94\uAC00'}
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
            onClick={() => {
              if (connections.length > 0) {
                setAddForm(prev => ({ ...prev, exchange: connections[0].exchange }))
              }
              setShowAdd(true)
            }}
            className="border border-border rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text text-text-muted"
          >
            {'\uC2EC\uBCFC \uCD94\uAC00'}
          </button>
        )}
      </div>
    </div>
  )
}


// ==================== Page ====================

export function DataSourcesPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Data Sources"
        description="Real-time market data connections."
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[640px] space-y-6">
          {/* Real-time Market Data zone */}
          <MarketDataWSSection />
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { strategyApi, type Strategy, type BacktestResult, type BacktestTrade } from '../api/strategy'
import { PageHeader } from '../components/PageHeader'
import { inputClass } from '../components/form'

const pnlColor = (v: number | null) => !v ? 'text-text-muted' : v > 0 ? 'text-green' : 'text-red'
const formatPnl = (v: number | null) => v === null ? '--' : (v > 0 ? '+' : '') + v.toFixed(2)

const statusBadge: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'bg-green-500/20', text: 'text-green-400' },
  running: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  error: { bg: 'bg-red-500/20', text: 'text-red-400' },
}

type PnlTab = 'daily' | 'weekly' | 'monthly'

export default function AITradingCenterPage() {
  // Form state
  const [exchange, setExchange] = useState('binance')
  const [symbol, setSymbol] = useState('BTC/USDT')
  const [timeframe, setTimeframe] = useState('1h')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [initialEquity, setInitialEquity] = useState(10000)

  // Strategy selection
  const [tradingStrategies, setTradingStrategies] = useState<Strategy[]>([])
  const [riskStrategies, setRiskStrategies] = useState<Strategy[]>([])
  const [selectedStrategies, setSelectedStrategies] = useState<Set<string>>(new Set())
  const [selectedRisks, setSelectedRisks] = useState<Set<string>>(new Set())

  // Results
  const [results, setResults] = useState<BacktestResult[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ result: BacktestResult; trades: BacktestTrade[] } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pnlTab, setPnlTab] = useState<PnlTab>('daily')

  // Load strategies and results
  useEffect(() => {
    Promise.all([
      strategyApi.getStrategies('trading'),
      strategyApi.getStrategies('risk'),
      strategyApi.getBacktests(),
    ]).then(([ts, rs, bt]) => {
      setTradingStrategies(ts)
      setRiskStrategies(rs)
      setSelectedStrategies(new Set(ts.filter(s => s.enabled).map(s => s.id)))
      setSelectedRisks(new Set(rs.filter(s => s.enabled).map(s => s.id)))
      setResults(bt)
    }).catch(() => {})
  }, [])

  const toggleStrategy = (id: string) => {
    setSelectedStrategies(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleRisk = (id: string) => {
    setSelectedRisks(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const runBacktest = async () => {
    setRunning(true); setError(null)
    try {
      for (const s of tradingStrategies) {
        await strategyApi.toggleStrategy(s.id, selectedStrategies.has(s.id))
      }
      for (const r of riskStrategies) {
        await strategyApi.toggleStrategy(r.id, selectedRisks.has(r.id))
      }

      await strategyApi.runBacktest({
        name: `${symbol} ${timeframe} (${startDate} ~ ${endDate})`,
        exchange, symbol, timeframe,
        startDate, endDate,
        initialEquity,
      })
      const updated = await strategyApi.getBacktests()
      setResults(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed')
    }
    setRunning(false)
  }

  const handleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null)
      setDetail(null)
      return
    }
    setExpanded(id)
    setPnlTab('daily')
    try {
      const d = await strategyApi.getBacktestDetail(id)
      setDetail(d)
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    await strategyApi.deleteBacktest(id)
    setExpanded(null)
    setDetail(null)
    const updated = await strategyApi.getBacktests()
    setResults(updated)
  }

  const getPnlData = (): Record<string, number> | null => {
    if (!detail) return null
    if (pnlTab === 'daily') return detail.result.dailyPnl
    if (pnlTab === 'weekly') return detail.result.weeklyPnl
    return detail.result.monthlyPnl
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="AI Trading Center" description="전략 백테스트 및 성과 분석" />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[720px] space-y-5">

          {/* ── Backtest Configuration ── */}
          <div className="bg-bg-secondary/50 border border-border/60 rounded-xl p-5">
            <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-4">
              Backtest Configuration
            </h3>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Exchange */}
              <div>
                <label className="block text-[13px] text-text mb-1.5 font-medium">거래소</label>
                <select
                  value={exchange}
                  onChange={e => setExchange(e.target.value)}
                  className={inputClass}
                >
                  <option value="binance">Binance</option>
                  <option value="bybit">Bybit</option>
                </select>
              </div>

              {/* Symbol */}
              <div>
                <label className="block text-[13px] text-text mb-1.5 font-medium">심볼</label>
                <input
                  value={symbol}
                  onChange={e => setSymbol(e.target.value)}
                  placeholder="BTC/USDT"
                  className={inputClass}
                />
              </div>

              {/* Timeframe */}
              <div>
                <label className="block text-[13px] text-text mb-1.5 font-medium">타임프레임</label>
                <select
                  value={timeframe}
                  onChange={e => setTimeframe(e.target.value)}
                  className={inputClass}
                >
                  <option value="1m">1m</option>
                  <option value="5m">5m</option>
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                  <option value="1d">1d</option>
                </select>
              </div>

              {/* Initial Equity */}
              <div>
                <label className="block text-[13px] text-text mb-1.5 font-medium">초기 자본</label>
                <input
                  type="number"
                  value={initialEquity}
                  onChange={e => setInitialEquity(Number(e.target.value))}
                  min={0}
                  step={1000}
                  className={inputClass}
                />
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-[13px] text-text mb-1.5 font-medium">시작일</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* End Date */}
              <div>
                <label className="block text-[13px] text-text mb-1.5 font-medium">종료일</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Trading Strategies */}
            <div className="mb-4">
              <p className="text-[13px] text-text font-medium mb-2">Trading Strategies</p>
              {tradingStrategies.length === 0 ? (
                <p className="text-[12px] text-text-muted">등록된 전략이 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {tradingStrategies.map(s => (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-secondary/80 transition-colors cursor-pointer"
                      onClick={() => toggleStrategy(s.id)}
                    >
                      <div
                        className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                          selectedStrategies.has(s.id)
                            ? 'bg-accent'
                            : 'bg-bg-tertiary border border-border hover:border-text-muted'
                        }`}
                      >
                        {selectedStrategies.has(s.id) && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-text truncate block">{s.name}</span>
                        {s.description && (
                          <span className="text-[11px] text-text-muted truncate block">{s.description}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Risk Management */}
            <div className="mb-4">
              <p className="text-[13px] text-text font-medium mb-2">Risk Management</p>
              {riskStrategies.length === 0 ? (
                <p className="text-[12px] text-text-muted">등록된 리스크 전략이 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {riskStrategies.map(s => (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-secondary/80 transition-colors cursor-pointer"
                      onClick={() => toggleRisk(s.id)}
                    >
                      <div
                        className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                          selectedRisks.has(s.id)
                            ? 'bg-accent'
                            : 'bg-bg-tertiary border border-border hover:border-text-muted'
                        }`}
                      >
                        {selectedRisks.has(s.id) && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-text truncate block">{s.name}</span>
                        {s.description && (
                          <span className="text-[11px] text-text-muted truncate block">{s.description}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Error message */}
            {error && (
              <p className="text-[12px] text-red-400 mb-3 px-1">{error}</p>
            )}

            {/* Run button */}
            <button
              onClick={runBacktest}
              disabled={running}
              className="w-full bg-accent/20 border border-accent/30 rounded-[10px] px-4 py-2.5 text-[13px] font-medium text-accent hover:bg-accent/30 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {running ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                  </svg>
                  백테스트 실행 중...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  Run Backtest
                </>
              )}
            </button>
          </div>

          {/* ── Past Results ── */}
          <div>
            <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-3 px-1">
              Past Results
            </h3>

            {results.length === 0 && (
              <p className="text-[13px] text-text-muted py-8 text-center">
                백테스트 결과가 없습니다.
              </p>
            )}

            <div className="space-y-3">
              {results.map(bt => {
                const badge = statusBadge[bt.status] || statusBadge.error
                return (
                  <div key={bt.id} className="border border-border rounded-xl overflow-hidden">
                    {/* Card header */}
                    <div
                      className="px-4 py-3 cursor-pointer hover:bg-bg-secondary/50 transition-colors"
                      onClick={() => handleExpand(bt.id)}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[13px] font-semibold text-text truncate">{bt.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.bg} ${badge.text}`}>
                            {bt.status}
                          </span>
                        </div>
                        <svg className={`w-4 h-4 text-text-muted transition-transform shrink-0 ${expanded === bt.id ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
                        <span>{bt.exchange}</span>
                        <span>{bt.symbols.join(', ')}</span>
                        <span>{bt.timeframe}</span>
                        <span>{bt.startDate} ~ {bt.endDate}</span>
                      </div>

                      {bt.status === 'completed' && bt.totalPnl != null && (
                        <div className="flex items-center gap-4 mt-2 text-[12px]">
                          <span className={`font-semibold ${pnlColor(bt.totalPnl)}`}>PNL: {formatPnl(bt.totalPnl)}</span>
                          <span className="text-text-muted">거래: {bt.totalTrades ?? 0}</span>
                          {bt.wins != null && bt.losses != null && (
                            <span className="text-text-muted">승: {bt.wins} / 패: {bt.losses}</span>
                          )}
                          {bt.winRate != null && <span className="text-text-muted">승률: {(bt.winRate * 100).toFixed(1)}%</span>}
                        </div>
                      )}
                      {bt.status === 'error' && bt.error && (
                        <p className="text-[11px] text-red-400 mt-1.5 truncate">{bt.error}</p>
                      )}
                    </div>

                    {/* Expanded detail */}
                    {expanded === bt.id && (
                      <div className="border-t border-border px-4 py-4">
                        {!detail || detail.result.id !== bt.id ? (
                          <div className="flex items-center gap-2 py-3">
                            <svg className="animate-spin w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                            </svg>
                            <p className="text-[12px] text-text-muted">불러오는 중...</p>
                          </div>
                        ) : (
                          <>
                            {/* Summary stats grid */}
                            <div className="grid grid-cols-5 gap-3 mb-4">
                              {[
                                { label: '총 PNL', value: detail.result.totalPnl != null ? formatPnl(detail.result.totalPnl) : '--', color: detail.result.totalPnl != null ? pnlColor(detail.result.totalPnl) : '' },
                                { label: '총 거래', value: String(detail.result.totalTrades ?? '--'), color: '' },
                                { label: '승리', value: String(detail.result.wins ?? '--'), color: 'text-green' },
                                { label: '패배', value: String(detail.result.losses ?? '--'), color: 'text-red' },
                                { label: '승률', value: detail.result.winRate != null ? `${(detail.result.winRate * 100).toFixed(1)}%` : '--', color: '' },
                              ].map(stat => (
                                <div key={stat.label} className="bg-bg-secondary rounded-lg p-2.5 text-center">
                                  <p className="text-[10px] text-text-muted uppercase tracking-wide">{stat.label}</p>
                                  <p className={`text-[14px] font-semibold mt-0.5 ${stat.color || 'text-text'}`}>{stat.value}</p>
                                </div>
                              ))}
                            </div>

                            {/* Strategy/Risk IDs */}
                            {(detail.result.strategyIds.length > 0 || detail.result.riskIds.length > 0) && (
                              <div className="flex flex-wrap gap-2 mb-4 text-[10px]">
                                {detail.result.strategyIds.map(id => (
                                  <span key={id} className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">전략: {id.slice(0, 8)}</span>
                                ))}
                                {detail.result.riskIds.map(id => (
                                  <span key={id} className="bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded-full">리스크: {id.slice(0, 8)}</span>
                                ))}
                              </div>
                            )}

                            {/* PNL tabs */}
                            <div className="flex items-center gap-1 mb-3 border-b border-border">
                              {(['daily', 'weekly', 'monthly'] as const).map(tab => (
                                <button
                                  key={tab}
                                  onClick={() => setPnlTab(tab)}
                                  className={`px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
                                    pnlTab === tab
                                      ? 'border-accent text-text'
                                      : 'border-transparent text-text-muted hover:text-text'
                                  }`}
                                >
                                  {tab === 'daily' ? '일별 PNL' : tab === 'weekly' ? '주별 PNL' : '월별 PNL'}
                                </button>
                              ))}
                            </div>

                            {/* PNL table */}
                            {(() => {
                              const pnlData = getPnlData()
                              if (!pnlData || Object.keys(pnlData).length === 0) {
                                return <p className="text-[12px] text-text-muted py-3">PNL 데이터가 없습니다.</p>
                              }
                              const entries = Object.entries(pnlData).sort(([a], [b]) => a.localeCompare(b))
                              return (
                                <div className="border border-border rounded-lg overflow-hidden mb-4">
                                  <table className="w-full text-[12px]">
                                    <thead>
                                      <tr className="bg-bg-secondary text-text-muted">
                                        <th className="text-left px-3 py-2 font-medium">날짜</th>
                                        <th className="text-right px-3 py-2 font-medium">PNL</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entries.map(([date, pnl]) => (
                                        <tr key={date} className="border-t border-border">
                                          <td className="px-3 py-1.5 text-text">{date}</td>
                                          <td className={`px-3 py-1.5 text-right font-medium ${pnlColor(pnl)}`}>{formatPnl(pnl)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )
                            })()}

                            {/* Trade log */}
                            {detail.trades.length > 0 && (
                              <>
                                <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">거래 내역</p>
                                <div className="border border-border rounded-lg overflow-x-auto mb-4">
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="bg-bg-secondary text-text-muted">
                                        <th className="text-left px-3 py-2 font-medium">심볼</th>
                                        <th className="text-left px-3 py-2 font-medium">방향</th>
                                        <th className="text-right px-3 py-2 font-medium">진입가</th>
                                        <th className="text-right px-3 py-2 font-medium">청산가</th>
                                        <th className="text-right px-3 py-2 font-medium">수량</th>
                                        <th className="text-right px-3 py-2 font-medium">PNL</th>
                                        <th className="text-left px-3 py-2 font-medium">시간</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detail.trades.map(t => (
                                        <tr key={t.id} className="border-t border-border">
                                          <td className="px-3 py-1.5 text-text font-medium">{t.symbol}</td>
                                          <td className={`px-3 py-1.5 ${t.side === 'buy' ? 'text-green' : 'text-red'}`}>
                                            {t.side === 'buy' ? '매수' : '매도'}
                                          </td>
                                          <td className="px-3 py-1.5 text-right text-text">{t.entryPrice.toFixed(2)}</td>
                                          <td className="px-3 py-1.5 text-right text-text">{t.exitPrice != null ? t.exitPrice.toFixed(2) : '--'}</td>
                                          <td className="px-3 py-1.5 text-right text-text">{t.quantity}</td>
                                          <td className={`px-3 py-1.5 text-right font-medium ${t.pnl != null ? pnlColor(t.pnl) : ''}`}>
                                            {t.pnl != null ? formatPnl(t.pnl) : '--'}
                                          </td>
                                          <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">
                                            {new Date(t.entryTime).toLocaleString('ko', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}

                            {/* Delete + timestamp */}
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-text-muted">생성: {new Date(detail.result.createdAt).toLocaleString('ko')}</span>
                              <button onClick={() => handleDelete(bt.id)} className="text-[11px] text-red-400 hover:text-red-300 cursor-pointer">삭제</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

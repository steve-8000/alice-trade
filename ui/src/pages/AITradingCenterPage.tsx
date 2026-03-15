import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { strategyApi, type BacktestResult, type BacktestTrade } from '../api/strategy'
import { PageHeader } from '../components/PageHeader'

const pnlColor = (v: number) => v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-text-muted'
const fmtPnl = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2)

const statusBadge: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'bg-green-500/20', text: 'text-green-400' },
  running: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  error: { bg: 'bg-red-500/20', text: 'text-red-400' },
}

type PnlTab = 'daily' | 'weekly' | 'monthly'

export default function AITradingCenterPage() {
  const [backtests, setBacktests] = useState<BacktestResult[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ result: BacktestResult; trades: BacktestTrade[] } | null>(null)
  const [pnlTab, setPnlTab] = useState<PnlTab>('daily')
  const navigate = useNavigate()

  const load = async () => {
    try { setBacktests(await strategyApi.getBacktests()) } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

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
    load()
  }

  const handleRunBacktest = () => {
    navigate('/?msg=' + encodeURIComponent('활성화된 전략과 리스크 전략을 기반으로 백테스트를 실행해주세요. 최근 30일 데이터를 사용하고, 결과를 상세히 분석해주세요.'))
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
        <div className="max-w-[720px] space-y-3">
          {backtests.length === 0 && (
            <p className="text-[13px] text-text-muted py-8 text-center">
              백테스트 결과가 없습니다.<br />채팅에서 AI에게 백테스트를 요청하세요.
            </p>
          )}

          {backtests.map(bt => {
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
                      <span className={`font-semibold ${pnlColor(bt.totalPnl)}`}>PNL: {fmtPnl(bt.totalPnl)}</span>
                      <span className="text-text-muted">거래: {bt.totalTrades ?? 0}</span>
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
                      <p className="text-[12px] text-text-muted">불러오는 중...</p>
                    ) : (
                      <>
                        {/* Summary stats grid */}
                        <div className="grid grid-cols-5 gap-3 mb-4">
                          {[
                            { label: '총 PNL', value: detail.result.totalPnl != null ? fmtPnl(detail.result.totalPnl) : '--', color: detail.result.totalPnl != null ? pnlColor(detail.result.totalPnl) : '' },
                            { label: '총 거래', value: String(detail.result.totalTrades ?? '--'), color: '' },
                            { label: '승리', value: String(detail.result.wins ?? '--'), color: 'text-green-400' },
                            { label: '패배', value: String(detail.result.losses ?? '--'), color: 'text-red-400' },
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
                                      <td className={`px-3 py-1.5 text-right font-medium ${pnlColor(pnl)}`}>{fmtPnl(pnl)}</td>
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
                                      <td className={`px-3 py-1.5 ${t.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                                        {t.side === 'buy' ? '매수' : '매도'}
                                      </td>
                                      <td className="px-3 py-1.5 text-right text-text">{t.entryPrice.toFixed(2)}</td>
                                      <td className="px-3 py-1.5 text-right text-text">{t.exitPrice != null ? t.exitPrice.toFixed(2) : '--'}</td>
                                      <td className="px-3 py-1.5 text-right text-text">{t.quantity}</td>
                                      <td className={`px-3 py-1.5 text-right font-medium ${t.pnl != null ? pnlColor(t.pnl) : ''}`}>
                                        {t.pnl != null ? fmtPnl(t.pnl) : '--'}
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

                        {/* Delete */}
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

          {/* Run backtest button */}
          <button
            onClick={handleRunBacktest}
            className="w-full border border-blue-500/30 bg-blue-500/10 rounded-xl px-4 py-3 text-[13px] font-medium text-blue-400 hover:bg-blue-500/20 transition-colors cursor-pointer"
          >
            백테스트 실행
          </button>
        </div>
      </div>
    </div>
  )
}

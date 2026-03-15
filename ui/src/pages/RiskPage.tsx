import { useState, useEffect } from 'react'
import { strategyApi, type Strategy } from '../api/strategy'
import { PageHeader } from '../components/PageHeader'

export default function RiskPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    try { setStrategies(await strategyApi.getStrategies('risk')) } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  const handleToggle = async (e: React.MouseEvent, id: string, enabled: boolean) => {
    e.stopPropagation()
    await strategyApi.toggleStrategy(id, enabled)
    load()
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await strategyApi.deleteStrategy(id)
    load()
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Risk Management" description="리스크 관리 전략을 관리합니다. 모든 거래에 최우선 적용됩니다." />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[640px] space-y-2.5">
          {/* Warning banner */}
          <div className="flex items-center gap-2.5 rounded-xl bg-[#2d2200] border border-[#ffc342]/25 px-4 py-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffc342" strokeWidth="2" strokeLinecap="round" className="shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="text-[12px] text-[#ffc342]/90">활성화된 리스크 전략은 모든 거래에 자동 적용됩니다</span>
          </div>

          {strategies.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-bg-tertiary flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <p className="text-[13px] text-text-muted text-center">
                등록된 리스크 전략이 없습니다.<br />
                <span className="text-text-muted/60">채팅에서 AI에게 리스크 전략을 요청하세요.</span>
              </p>
            </div>
          )}

          {strategies.map(s => {
            const isExpanded = expanded === s.id
            return (
              <div
                key={s.id}
                className={`rounded-xl border transition-colors ${
                  s.enabled
                    ? 'border-[#ffc342]/30 bg-[#ffc342]/[0.04]'
                    : 'border-border bg-bg-secondary/50'
                }`}
              >
                <div
                  className="px-4 py-3.5 flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : s.id)}
                >
                  <div
                    onClick={(e) => handleToggle(e, s.id, !s.enabled)}
                    className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                      s.enabled
                        ? 'bg-[#ffc342]'
                        : 'bg-bg-tertiary border border-border hover:border-text-muted'
                    }`}
                  >
                    {s.enabled && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#17171c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13px] font-semibold truncate ${s.enabled ? 'text-text' : 'text-text-muted'}`}>
                        {s.name}
                      </span>
                      {s.source === 'ai' && (
                        <span className="shrink-0 text-[9px] px-1.5 py-[1px] rounded bg-accent/15 text-accent font-semibold tracking-wide">AI</span>
                      )}
                    </div>
                    <p className={`text-[11px] mt-0.5 truncate ${s.enabled ? 'text-text-muted' : 'text-text-muted/60'}`}>
                      {s.description.split('\n')[0]}
                    </p>
                  </div>

                  <svg
                    className={`shrink-0 w-4 h-4 text-text-muted/50 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border/40 pt-3 space-y-3">
                    <p className="text-[12px] text-text leading-relaxed whitespace-pre-wrap">{s.description}</p>

                    <div className="rounded-lg bg-bg/60 border border-border/40 p-3">
                      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Parameters</p>
                      <pre className="text-[11px] text-text-muted overflow-x-auto">
                        {JSON.stringify(s.config, null, 2)}
                      </pre>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-3 text-[10px] text-text-muted/60">
                        <span>Created {new Date(s.createdAt).toLocaleDateString('ko')}</span>
                        <span>Updated {new Date(s.updatedAt).toLocaleDateString('ko')}</span>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, s.id)}
                        className="text-[11px] text-red/70 hover:text-red transition-colors cursor-pointer px-2 py-1 rounded-md hover:bg-red/10"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

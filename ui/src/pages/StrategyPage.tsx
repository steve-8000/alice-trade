import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { strategyApi, type Strategy } from '../api/strategy'
import { PageHeader } from '../components/PageHeader'

export default function StrategyPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const navigate = useNavigate()

  const load = async () => {
    try { setStrategies(await strategyApi.getStrategies('trading')) } catch { /* ignore */ }
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

  const handleRefine = () => {
    navigate('/?msg=' + encodeURIComponent('Analyze the active strategies and recent backtest results, then create an AI-refined strategy with fine-tuned parameters.'))
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Strategy" description="AI 트레이딩 전략을 관리합니다." />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[640px] space-y-2.5">
          {strategies.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-bg-tertiary flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                  <path d="M2 20h20" /><path d="M7 10l3-3 3 3 5-5" /><polyline points="17 5 21 5 21 9" />
                </svg>
              </div>
              <p className="text-[13px] text-text-muted text-center">
                등록된 전략이 없습니다.<br />
                <span className="text-text-muted/60">채팅에서 AI에게 전략을 요청하세요.</span>
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
                    ? 'border-accent/30 bg-accent/[0.04]'
                    : 'border-border bg-bg-secondary/50'
                }`}
              >
                {/* Header row */}
                <div
                  className="px-4 py-3.5 flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : s.id)}
                >
                  {/* Status indicator */}
                  <div
                    onClick={(e) => handleToggle(e, s.id, !s.enabled)}
                    className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                      s.enabled
                        ? 'bg-accent'
                        : 'bg-bg-tertiary border border-border hover:border-text-muted'
                    }`}
                  >
                    {s.enabled && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13px] font-semibold truncate ${s.enabled ? 'text-text' : 'text-text-muted'}`}>
                        {s.name}
                      </span>
                      {s.source === 'ai' && (
                        <span className="shrink-0 text-[9px] px-1.5 py-[1px] rounded bg-accent/15 text-accent font-semibold tracking-wide">AI</span>
                      )}
                      {s.parentId && (
                        <span className="shrink-0 text-[9px] px-1.5 py-[1px] rounded bg-purple-dim text-purple font-medium">Refined</span>
                      )}
                    </div>
                    <p className={`text-[11px] mt-0.5 truncate ${s.enabled ? 'text-text-muted' : 'text-text-muted/60'}`}>
                      {s.description.split('\n')[0]}
                    </p>
                  </div>

                  {/* Chevron */}
                  <svg
                    className={`shrink-0 w-4 h-4 text-text-muted/50 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>

                {/* Expanded detail */}
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

          {strategies.length > 0 && (
            <button
              onClick={handleRefine}
              className="w-full rounded-xl px-4 py-3.5 text-[13px] font-semibold text-accent bg-accent/10 hover:bg-accent/15 transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73v1.27h1a7 7 0 0 1 7 7h1.27c.34-.6.99-1 1.73-1a2 2 0 1 1 0 4c-.74 0-1.39-.4-1.73-1H21a7 7 0 0 1-7 7v1.27c.6.34 1 .99 1 1.73a2 2 0 1 1-4 0c0-.74.4-1.39 1-1.73V21a7 7 0 0 1-7-7H2.73c-.34.6-.99 1-1.73 1a2 2 0 1 1 0-4c.74 0 1.39.4 1.73 1H4a7 7 0 0 1 7-7V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                <circle cx="12" cy="14" r="3" />
              </svg>
              AI 전략 추천 (백테스트 기반 미세조정)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

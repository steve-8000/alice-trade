import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { strategyApi, type Strategy } from '../api/strategy'
import { PageHeader } from '../components/PageHeader'
import { Toggle } from '../components/Toggle'

export default function StrategyPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const navigate = useNavigate()

  const load = async () => {
    try { setStrategies(await strategyApi.getStrategies('trading')) } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  const handleToggle = async (id: string, enabled: boolean) => {
    await strategyApi.toggleStrategy(id, enabled)
    load()
  }

  const handleDelete = async (id: string) => {
    await strategyApi.deleteStrategy(id)
    load()
  }

  const handleRefine = () => {
    navigate('/?msg=' + encodeURIComponent('활성화된 전략과 최근 백테스트 결과를 분석하여, 전략의 매개변수를 미세조정한 AI 추천 전략을 생성해주세요.'))
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Strategy" description="AI 트레이딩 전략을 관리합니다." />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[640px] space-y-3">
          {strategies.length === 0 && (
            <p className="text-[13px] text-text-muted py-8 text-center">
              등록된 전략이 없습니다.<br />채팅에서 AI에게 전략을 요청하세요.
            </p>
          )}
          {strategies.map(s => (
            <div key={s.id} className="border border-border rounded-xl overflow-hidden">
              <div
                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-bg-secondary/50 transition-colors"
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Toggle checked={s.enabled} onChange={(v) => { handleToggle(s.id, v) }} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-text truncate">{s.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.source === 'ai' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'}`}>
                        {s.source === 'ai' ? 'AI' : 'User'}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted truncate mt-0.5">{s.description.split('\n')[0]}</p>
                  </div>
                </div>
                <svg className={`w-4 h-4 text-text-muted transition-transform ${expanded === s.id ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
              </div>
              {expanded === s.id && (
                <div className="px-4 pb-3 border-t border-border pt-3">
                  <p className="text-[12px] text-text whitespace-pre-wrap mb-3">{s.description}</p>
                  <pre className="text-[11px] bg-bg-tertiary rounded-lg p-3 overflow-x-auto mb-3">
                    {JSON.stringify(s.config, null, 2)}
                  </pre>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted">생성: {new Date(s.createdAt).toLocaleDateString('ko')}</span>
                    <span className="text-[10px] text-text-muted">&middot;</span>
                    <span className="text-[10px] text-text-muted">수정: {new Date(s.updatedAt).toLocaleDateString('ko')}</span>
                    {s.parentId && (
                      <>
                        <span className="text-[10px] text-text-muted">&middot;</span>
                        <span className="text-[10px] text-blue-400">원본 전략에서 미세조정됨</span>
                      </>
                    )}
                    <span className="flex-1" />
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id) }} className="text-[11px] text-red-400 hover:text-red-300 cursor-pointer">삭제</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {strategies.length > 0 && (
            <button
              onClick={handleRefine}
              className="w-full border border-blue-500/30 bg-blue-500/10 rounded-xl px-4 py-3 text-[13px] font-medium text-blue-400 hover:bg-blue-500/20 transition-colors cursor-pointer"
            >
              AI 전략 추천 (백테스트 기반 미세조정)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, type AppConfig } from '../api'
import { Toggle } from '../components/Toggle'
import { SaveIndicator } from '../components/SaveIndicator'
import { Section, Field, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/StateViews'

// Inline sub-pages
import { DataSourcesPage } from './DataSourcesPage'
import { ConnectorsPage } from './ConnectorsPage'
import { ToolsPage } from './ToolsPage'
import { AIProviderPage } from './AIProviderPage'
import { TradingPage } from './TradingPage'
import { DevPage } from './DevPage'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'ai-provider', label: 'AI Provider' },
  { id: 'trading', label: 'Trading' },
  { id: 'data-sources', label: 'Data Sources' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'tools', label: 'Tools' },
  { id: 'dev', label: 'Dev' },
] as const

type TabId = typeof TABS[number]['id']

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('general')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="Settings" />

      {/* Tab bar */}
      <div className="shrink-0 border-b border-border/60 px-4 md:px-6">
        <div className="flex gap-0 overflow-x-auto no-scrollbar">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'text-text'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'general' && <GeneralTab />}
        {activeTab === 'ai-provider' && <AIProviderPage />}
        {activeTab === 'trading' && <TradingPage />}
        {activeTab === 'data-sources' && <DataSourcesPage />}
        {activeTab === 'connectors' && <ConnectorsPage />}
        {activeTab === 'tools' && <ToolsPage />}
        {activeTab === 'dev' && <DevPage />}
      </div>
    </div>
  )
}

// ==================== General Tab (original Settings content) ====================

function GeneralTab() {
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => {})
  }, [])

  if (!config) return <PageLoading />

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
      <div className="max-w-[640px] space-y-5">
        <Section id="agent" title="Agent" description="Controls file-system and tool permissions for the AI. Changes apply on the next request.">
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="flex-1">
              <span className="text-sm font-medium text-text">Evolution Mode</span>
              <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">
                {config.agent?.evolutionMode
                  ? 'Full project access — AI can modify source code'
                  : 'Sandbox mode — AI can only edit data/brain/'}
              </p>
            </div>
            <Toggle
              checked={config.agent?.evolutionMode || false}
              onChange={async (v) => {
                try {
                  await api.config.updateSection('agent', { ...config.agent, evolutionMode: v })
                  setConfig((c) => c ? { ...c, agent: { ...c.agent, evolutionMode: v } } : c)
                } catch { /* ignore */ }
              }}
            />
          </div>
        </Section>

        <Section id="compaction" title="Compaction" description="Context window management. When conversation size approaches Max Context minus Max Output tokens, older messages are automatically summarized to free up space.">
          <CompactionForm config={config} />
        </Section>
      </div>
    </div>
  )
}

// ==================== Form Sections ====================

function CompactionForm({ config }: { config: AppConfig }) {
  const [ctx, setCtx] = useState(String(config.compaction?.maxContextTokens || ''))
  const [out, setOut] = useState(String(config.compaction?.maxOutputTokens || ''))

  const data = useMemo(
    () => ({ maxContextTokens: Number(ctx), maxOutputTokens: Number(out) }),
    [ctx, out],
  )

  const save = useCallback(async (d: { maxContextTokens: number; maxOutputTokens: number }) => {
    await api.config.updateSection('compaction', d)
  }, [])

  const { status, retry } = useAutoSave({ data, save })

  return (
    <>
      <Field label="Max Context Tokens">
        <input className={inputClass} type="number" step={1000} value={ctx} onChange={(e) => setCtx(e.target.value)} />
      </Field>
      <Field label="Max Output Tokens">
        <input className={inputClass} type="number" step={1000} value={out} onChange={(e) => setOut(e.target.value)} />
      </Field>
      <SaveIndicator status={status} onRetry={retry} />
    </>
  )
}

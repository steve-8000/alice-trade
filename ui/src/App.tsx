import { useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useWebSocket } from './hooks/useWebSocket'
import { Sidebar } from './components/Sidebar'
import { ChatPage } from './pages/ChatPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { EventsPage } from './pages/EventsPage'
import { SettingsPage } from './pages/SettingsPage'
import { HeartbeatPage } from './pages/HeartbeatPage'
import StrategyPage from './pages/StrategyPage'
import RiskPage from './pages/RiskPage'
import AITradingCenterPage from './pages/AITradingCenterPage'

export type Page =
  | 'chat' | 'portfolio' | 'events' | 'heartbeat' | 'data-sources' | 'connectors'
  | 'trading' | 'strategy' | 'risk' | 'ai-trading'
  | 'ai-provider' | 'settings' | 'tools' | 'dev'

/** Page type → URL path mapping. Chat is the root, everything else maps to /slug. */
export const ROUTES: Record<Page, string> = {
  'chat': '/',
  'portfolio': '/portfolio',
  'events': '/events',
  'heartbeat': '/heartbeat',
  'data-sources': '/data-sources',
  'connectors': '/connectors',
  'tools': '/tools',
  'trading': '/trading',
  'strategy': '/strategy',
  'risk': '/risk',
  'ai-trading': '/ai-trading',
  'ai-provider': '/ai-provider',
  'settings': '/settings',
  'dev': '/dev',
}

export function App() {
  const [sseConnected, setSseConnected] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { aiWorking, lastTool } = useWebSocket()
  const location = useLocation()

  return (
    <div className="flex h-full">
      <Sidebar
        sseConnected={sseConnected}
        aiWorking={aiWorking}
        aiLastTool={lastTool}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-bg">
        {/* Mobile header — visible only below md */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-bg-secondary shrink-0 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-text-muted hover:text-text p-1 -ml-1"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-text">Clab</span>
          {aiWorking && (
            <span className="text-[11px] text-accent animate-pulse">AI working...</span>
          )}
        </div>
        <div key={location.pathname} className="page-fade-in flex-1 flex flex-col min-h-0">
          <Routes>
            <Route path="/" element={<ChatPage onSSEStatus={setSseConnected} />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/heartbeat" element={<HeartbeatPage />} />
            <Route path="/strategy" element={<StrategyPage />} />
            <Route path="/risk" element={<RiskPage />} />
            <Route path="/ai-trading" element={<AITradingCenterPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* Redirect old individual routes to settings */}
            <Route path="/data-sources" element={<Navigate to="/settings" replace />} />
            <Route path="/connectors" element={<Navigate to="/settings" replace />} />
            <Route path="/tools" element={<Navigate to="/settings" replace />} />
            <Route path="/trading" element={<Navigate to="/settings" replace />} />
            <Route path="/ai-provider" element={<Navigate to="/settings" replace />} />
            <Route path="/dev" element={<Navigate to="/settings" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

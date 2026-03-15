export interface Strategy {
  id: string
  name: string
  description: string
  type: 'trading' | 'risk'
  config: Record<string, unknown>
  enabled: boolean
  createdAt: string
  updatedAt: string
  source: 'ai' | 'user'
  parentId: string | null
}

export interface BacktestResult {
  id: string
  name: string
  exchange: string
  symbols: string[]
  timeframe: string
  startDate: string
  endDate: string
  strategyIds: string[]
  riskIds: string[]
  status: 'running' | 'completed' | 'error'
  createdAt: string
  totalPnl: number | null
  totalTrades: number | null
  wins: number | null
  losses: number | null
  winRate: number | null
  dailyPnl: Record<string, number> | null
  weeklyPnl: Record<string, number> | null
  monthlyPnl: Record<string, number> | null
  error: string | null
}

export interface BacktestTrade {
  id: string
  backtestId: string
  symbol: string
  side: 'buy' | 'sell'
  entryPrice: number
  exitPrice: number | null
  quantity: number
  entryTime: string
  exitTime: string | null
  pnl: number | null
  status: 'open' | 'closed'
}

export const strategyApi = {
  async getStrategies(type?: 'trading' | 'risk'): Promise<Strategy[]> {
    const url = type ? `/api/strategy/strategies?type=${type}` : '/api/strategy/strategies'
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch strategies')
    return res.json()
  },

  async toggleStrategy(id: string, enabled: boolean): Promise<void> {
    await fetch(`/api/strategy/strategies/${id}/toggle`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
  },

  async deleteStrategy(id: string): Promise<void> {
    await fetch(`/api/strategy/strategies/${id}`, { method: 'DELETE' })
  },

  async getBacktests(): Promise<BacktestResult[]> {
    const res = await fetch('/api/strategy/backtests')
    if (!res.ok) throw new Error('Failed to fetch backtests')
    return res.json()
  },

  async getBacktestDetail(id: string): Promise<{ result: BacktestResult; trades: BacktestTrade[] }> {
    const res = await fetch(`/api/strategy/backtests/${id}`)
    if (!res.ok) throw new Error('Failed to fetch backtest')
    return res.json()
  },

  async deleteBacktest(id: string): Promise<void> {
    await fetch(`/api/strategy/backtests/${id}`, { method: 'DELETE' })
  },
}

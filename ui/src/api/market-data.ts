export interface MarketDataConnection {
  id: string
  exchange: string
  symbols: string[]
  timeframes: string[]
  historyDays: number
  enabled: boolean
  status: 'disconnected' | 'connecting' | 'syncing' | 'connected' | 'error'
  firstBuilt: string | null
  lastUpdate: string | null
  error: string | null
  data?: Record<string, Record<string, { count: number; range: { oldest: number | null; newest: number | null } }>>
}

export const marketDataApi = {
  async getConnections(): Promise<MarketDataConnection[]> {
    const res = await fetch('/api/market-data/connections')
    if (!res.ok) throw new Error('Failed to fetch connections')
    return res.json()
  },

  async addConnection(config: {
    exchange: string
    symbols: string[]
    timeframes?: string[]
    historyDays?: number
  }): Promise<{ success: boolean; connection: MarketDataConnection }> {
    const res = await fetch('/api/market-data/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) throw new Error('Failed to add connection')
    return res.json()
  },

  async startConnection(id: string): Promise<void> {
    const res = await fetch(`/api/market-data/connections/${id}/start`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to start connection')
  },

  async stopConnection(id: string): Promise<void> {
    const res = await fetch(`/api/market-data/connections/${id}/stop`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to stop connection')
  },

  async deleteConnection(id: string): Promise<void> {
    const res = await fetch(`/api/market-data/connections/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete connection')
  },
}

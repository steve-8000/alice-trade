import ccxt from 'ccxt'
import type { MarketDataStore, Candle, ConnectionConfig } from './store.js'

const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
  '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000,
  '1d': 86_400_000, '1w': 604_800_000,
}

export class MarketDataEngine {
  private exchanges = new Map<string, ccxt.Exchange>()
  private wsLoops = new Map<string, AbortController>()
  private store: MarketDataStore

  constructor(store: MarketDataStore) {
    this.store = store
  }

  private getExchange(name: string): ccxt.Exchange {
    let ex = this.exchanges.get(name)
    if (!ex) {
      const ExClass = (ccxt as any)[name]
      if (!ExClass) throw new Error(`Exchange "${name}" not supported by CCXT`)
      ex = new ExClass({ enableRateLimit: true })
      this.exchanges.set(name, ex)
    }
    return ex
  }

  /** Fetch historical OHLCV and store in DB */
  async fetchHistory(connId: string, exchange: string, symbol: string, timeframe: string, days: number): Promise<number> {
    const ex = this.getExchange(exchange)
    const tfMs = TIMEFRAME_MS[timeframe] || 60_000
    const since = Date.now() - days * 86_400_000
    let cursor = since
    let total = 0

    while (cursor < Date.now()) {
      try {
        const ohlcv = await ex.fetchOHLCV(symbol, timeframe, cursor, 1000)
        if (!ohlcv.length) break

        const candles: Candle[] = ohlcv.map(([ts, o, h, l, c, v]) => ({
          exchange, symbol, timeframe,
          timestamp: ts!, open: o!, high: h!, low: l!, close: c!, volume: v!,
        }))
        this.store.insertCandles(candles)
        total += candles.length

        const lastTs = ohlcv[ohlcv.length - 1][0]!
        cursor = lastTs + tfMs
        if (ohlcv.length < 1000) break
      } catch (err) {
        console.error(`market-data: fetchHistory error ${exchange}/${symbol}/${timeframe}:`, err instanceof Error ? err.message : err)
        break
      }
    }
    return total
  }

  /** Start live polling for a connection (fetches latest candles periodically) */
  async startLive(conn: ConnectionConfig) {
    const key = conn.id
    if (this.wsLoops.has(key)) return

    const ac = new AbortController()
    this.wsLoops.set(key, ac)

    for (const symbol of conn.symbols) {
      for (const tf of conn.timeframes) {
        this.runPollLoop(conn.exchange, symbol, tf, ac.signal)
      }
    }
  }

  private async runPollLoop(exchange: string, symbol: string, timeframe: string, signal: AbortSignal) {
    const tfMs = TIMEFRAME_MS[timeframe] || 60_000
    const interval = Math.max(tfMs, 60_000) // poll at least every minute
    while (!signal.aborted) {
      await new Promise(r => setTimeout(r, interval))
      if (signal.aborted) break
      try {
        const ex = this.getExchange(exchange)
        const since = Date.now() - tfMs * 5 // overlap by 5 candles to catch updates
        const ohlcv = await ex.fetchOHLCV(symbol, timeframe, since, 10)
        if (ohlcv.length) {
          const candles: Candle[] = ohlcv.map(([ts, o, h, l, c, v]) => ({
            exchange, symbol, timeframe,
            timestamp: ts!, open: o!, high: h!, low: l!, close: c!, volume: v!,
          }))
          this.store.insertCandles(candles)
          this.store.updateConnectionStatus(
            this.findConnId(exchange) || exchange + '-ws',
            'connected'
          )
        }
      } catch (err) {
        if (signal.aborted) break
        console.error(`market-data: poll error ${exchange}/${symbol}/${timeframe}:`, err instanceof Error ? err.message : err)
      }
    }
  }

  private findConnId(exchange: string): string | undefined {
    return this.store.getConnections().find(c => c.exchange === exchange)?.id
  }

  /** Stop WebSocket for a connection */
  stopLive(connId: string) {
    const ac = this.wsLoops.get(connId)
    if (ac) {
      ac.abort()
      this.wsLoops.delete(connId)
    }
  }

  /** Full lifecycle: fetch history → start ws → update status */
  async startConnection(conn: ConnectionConfig) {
    try {
      this.store.updateConnectionStatus(conn.id, 'syncing')
      console.log(`market-data: syncing ${conn.exchange} (${conn.symbols.join(', ')}) — ${conn.historyDays} days`)

      for (const symbol of conn.symbols) {
        for (const tf of conn.timeframes) {
          const count = await this.fetchHistory(conn.id, conn.exchange, symbol, tf, conn.historyDays)
          console.log(`market-data: fetched ${count} candles for ${conn.exchange}/${symbol}/${tf}`)
        }
      }

      if (!this.store.getConnection(conn.id)?.firstBuilt) {
        this.store.upsertConnection({ ...conn, firstBuilt: new Date().toISOString(), status: 'connected', lastUpdate: new Date().toISOString() })
      } else {
        this.store.updateConnectionStatus(conn.id, 'connected')
      }

      await this.startLive(conn)
      console.log(`market-data: ${conn.exchange} connected (ws streaming)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.store.updateConnectionStatus(conn.id, 'error', msg)
      console.error(`market-data: ${conn.exchange} failed:`, msg)
    }
  }

  /** Stop a connection */
  stopConnection(connId: string) {
    this.stopLive(connId)
    this.store.updateConnectionStatus(connId, 'disconnected')
  }

  /** Start all enabled connections */
  async startAll() {
    const conns = this.store.getConnections().filter(c => c.enabled)
    for (const conn of conns) {
      this.startConnection(conn) // don't await — run in background
    }
  }

  /** Stop all */
  stopAll() {
    for (const [id] of this.wsLoops) {
      this.stopLive(id)
    }
    for (const [, ex] of this.exchanges) {
      try { (ex as any).close?.() } catch { /* ignore */ }
    }
  }

  getStore(): MarketDataStore {
    return this.store
  }
}

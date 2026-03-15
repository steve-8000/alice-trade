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

  /** Start WebSocket streaming for a connection */
  async startWs(conn: ConnectionConfig) {
    const key = conn.id
    if (this.wsLoops.has(key)) return

    const ac = new AbortController()
    this.wsLoops.set(key, ac)

    const ex = this.getExchange(conn.exchange)

    for (const symbol of conn.symbols) {
      for (const tf of conn.timeframes) {
        this.runWsLoop(ex, conn.exchange, symbol, tf, ac.signal)
      }
    }
  }

  private async runWsLoop(ex: ccxt.Exchange, exchange: string, symbol: string, timeframe: string, signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const ohlcv = await (ex as any).watchOHLCV(symbol, timeframe)
        if (signal.aborted) break
        const candles: Candle[] = ohlcv.map(([ts, o, h, l, c, v]: number[]) => ({
          exchange, symbol, timeframe,
          timestamp: ts, open: o, high: h, low: l, close: c, volume: v,
        }))
        this.store.insertCandles(candles)
      } catch (err) {
        if (signal.aborted) break
        console.error(`market-data: ws error ${exchange}/${symbol}/${timeframe}:`, err instanceof Error ? err.message : err)
        await new Promise(r => setTimeout(r, 5000))
      }
    }
  }

  /** Stop WebSocket for a connection */
  stopWs(connId: string) {
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

      await this.startWs(conn)
      console.log(`market-data: ${conn.exchange} connected (ws streaming)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.store.updateConnectionStatus(conn.id, 'error', msg)
      console.error(`market-data: ${conn.exchange} failed:`, msg)
    }
  }

  /** Stop a connection */
  stopConnection(connId: string) {
    this.stopWs(connId)
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
      this.stopWs(id)
    }
    for (const [, ex] of this.exchanges) {
      try { (ex as any).close?.() } catch { /* ignore */ }
    }
  }

  getStore(): MarketDataStore {
    return this.store
  }
}

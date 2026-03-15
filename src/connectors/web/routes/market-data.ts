import { Hono } from 'hono'
import type { MarketDataEngine } from '../../../extension/market-data/engine.js'
import type { ConnectionConfig } from '../../../extension/market-data/store.js'

export function createMarketDataRoutes(engine: MarketDataEngine) {
  const app = new Hono()
  const store = engine.getStore()

  // GET /api/market-data/connections — list all connections
  app.get('/connections', (c) => {
    const connections = store.getConnections()
    // Enrich with candle counts
    const enriched = connections.map(conn => {
      const data: Record<string, Record<string, { count: number; range: { oldest: number | null; newest: number | null } }>> = {}
      for (const sym of conn.symbols) {
        data[sym] = {}
        for (const tf of conn.timeframes) {
          data[sym][tf] = {
            count: store.getCandleCount(conn.exchange, sym, tf),
            range: store.getDateRange(conn.exchange, sym, tf),
          }
        }
      }
      return { ...conn, data }
    })
    return c.json(enriched)
  })

  // POST /api/market-data/connections — add/update connection (merges symbols if connection exists)
  app.post('/connections', async (c) => {
    const body = await c.req.json<{
      id?: string
      exchange: string
      symbols: string[]
      timeframes?: string[]
      historyDays?: number
      enabled?: boolean
    }>()

    const id = body.id || `${body.exchange}-ws`
    const existing = store.getConnection(id)

    if (existing) {
      // Merge symbols — add new ones, keep existing
      const existingSymbols = new Set(existing.symbols)
      const newSymbols = body.symbols.filter(s => !existingSymbols.has(s))
      const mergedSymbols = [...existing.symbols, ...newSymbols]

      // Update timeframes if provided
      const timeframes = body.timeframes || existing.timeframes
      const historyDays = body.historyDays || existing.historyDays

      const updated: ConnectionConfig = {
        ...existing,
        symbols: mergedSymbols,
        timeframes,
        historyDays,
      }
      store.upsertConnection(updated)

      // Only fetch history for NEW symbols
      if (newSymbols.length > 0 && updated.enabled) {
        const partialConn = { ...updated, symbols: newSymbols }
        engine.startConnection(partialConn)
      }

      return c.json({
        success: true,
        connection: store.getConnection(id),
        newSymbols,
        message: newSymbols.length > 0
          ? `Added ${newSymbols.length} new symbol(s): ${newSymbols.join(', ')}`
          : 'No new symbols to add (all already exist)',
      })
    }

    // New connection
    const conn: ConnectionConfig = {
      id,
      exchange: body.exchange,
      symbols: body.symbols,
      timeframes: body.timeframes || ['1m', '5m', '1h'],
      historyDays: body.historyDays || 30,
      enabled: body.enabled !== false,
      status: 'disconnected',
      firstBuilt: null,
      lastUpdate: null,
      error: null,
    }

    store.upsertConnection(conn)

    if (conn.enabled) {
      engine.startConnection(conn)
    }

    return c.json({ success: true, connection: store.getConnection(id) })
  })

  // POST /api/market-data/connections/:id/start
  app.post('/connections/:id/start', async (c) => {
    const id = c.req.param('id')
    const conn = store.getConnection(id)
    if (!conn) return c.json({ error: 'Connection not found' }, 404)
    engine.startConnection(conn)
    return c.json({ success: true })
  })

  // POST /api/market-data/connections/:id/stop
  app.post('/connections/:id/stop', (c) => {
    const id = c.req.param('id')
    engine.stopConnection(id)
    return c.json({ success: true })
  })

  // DELETE /api/market-data/connections/:id/symbols/:symbol — remove a single symbol
  app.delete('/connections/:id/symbols/:symbol', (c) => {
    const id = c.req.param('id')
    const symbol = decodeURIComponent(c.req.param('symbol'))
    const conn = store.getConnection(id)
    if (!conn) return c.json({ error: 'Connection not found' }, 404)

    const updatedSymbols = conn.symbols.filter(s => s !== symbol)
    if (updatedSymbols.length === conn.symbols.length) {
      return c.json({ error: 'Symbol not found' }, 404)
    }

    store.upsertConnection({ ...conn, symbols: updatedSymbols })
    store.deleteCandles(conn.exchange, symbol)

    return c.json({ success: true, removedSymbol: symbol })
  })

  // DELETE /api/market-data/connections/:id
  app.delete('/connections/:id', (c) => {
    const id = c.req.param('id')
    engine.stopConnection(id)
    const conn = store.getConnection(id)
    if (conn) store.deleteCandles(conn.exchange)
    store.deleteConnection(id)
    return c.json({ success: true })
  })

  // GET /api/market-data/candles — query candle data
  app.get('/candles', (c) => {
    const exchange = c.req.query('exchange') || ''
    const symbol = c.req.query('symbol') || ''
    const timeframe = c.req.query('timeframe') || '1h'
    const since = c.req.query('since') ? Number(c.req.query('since')) : undefined
    const until = c.req.query('until') ? Number(c.req.query('until')) : undefined
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 500

    if (!exchange || !symbol) return c.json({ error: 'exchange and symbol required' }, 400)

    const candles = store.getCandles(exchange, symbol, timeframe, since, until, limit)
    return c.json({ exchange, symbol, timeframe, count: candles.length, candles })
  })

  return app
}

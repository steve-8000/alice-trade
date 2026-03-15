import { Hono } from 'hono'
import type { StrategyStore } from '../../../extension/strategy/store.js'
import type { BacktestEngine } from '../../../extension/strategy/backtest-engine.js'

export function createStrategyRoutes(store: StrategyStore, backtestEngine?: BacktestEngine) {
  const app = new Hono()

  // GET /api/strategy/strategies?type=trading|risk
  app.get('/strategies', (c) => {
    const type = c.req.query('type') as 'trading' | 'risk' | undefined
    return c.json(store.getStrategies(type))
  })

  // GET /api/strategy/strategies/:id
  app.get('/strategies/:id', (c) => {
    const s = store.getStrategy(c.req.param('id'))
    return s ? c.json(s) : c.json({ error: 'Not found' }, 404)
  })

  // PUT /api/strategy/strategies/:id/toggle
  app.put('/strategies/:id/toggle', async (c) => {
    const { enabled } = await c.req.json<{ enabled: boolean }>()
    store.toggleStrategy(c.req.param('id'), enabled)
    return c.json({ success: true })
  })

  // DELETE /api/strategy/strategies/:id
  app.delete('/strategies/:id', (c) => {
    store.deleteStrategy(c.req.param('id'))
    return c.json({ success: true })
  })

  // GET /api/strategy/backtests
  app.get('/backtests', (c) => {
    return c.json(store.getBacktestResults())
  })

  // GET /api/strategy/backtests/:id
  app.get('/backtests/:id', (c) => {
    const result = store.getBacktestResult(c.req.param('id'))
    if (!result) return c.json({ error: 'Not found' }, 404)
    const trades = store.getBacktestTrades(c.req.param('id'))
    return c.json({ result, trades })
  })

  // DELETE /api/strategy/backtests/:id
  app.delete('/backtests/:id', (c) => {
    store.deleteBacktest(c.req.param('id'))
    return c.json({ success: true })
  })

  // POST /api/strategy/backtests/run
  app.post('/backtests/run', async (c) => {
    if (!backtestEngine) return c.json({ error: 'Backtest engine not available' }, 500)
    const body = await c.req.json<{
      name: string
      exchange: string
      symbol: string
      timeframe: string
      startDate: string
      endDate: string
      initialEquity?: number
    }>()
    try {
      const id = await backtestEngine.run(body)
      const result = store.getBacktestResult(id)
      return c.json({ success: true, result })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  return app
}

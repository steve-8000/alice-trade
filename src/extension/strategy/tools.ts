import { tool } from 'ai'
import { z } from 'zod'
import type { StrategyStore } from './store.js'
import type { BacktestEngine } from './backtest-engine.js'

/** Strip non-numeric config values that the backtest engine can't read.
 *  Keeps: numbers, booleans, arrays of numbers, customFilters array.
 *  Removes: strings, objects (entryRules, exitRules, indicators, etc.) */
function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(config)) {
    if (key === 'enabled') continue  // handled separately
    if (key === 'customFilters' && Array.isArray(val)) { clean[key] = val; continue }
    if (typeof val === 'number' || typeof val === 'boolean') { clean[key] = val; continue }
    if (Array.isArray(val) && val.every(v => typeof v === 'number')) { clean[key] = val; continue }
    // Skip strings, objects, etc. — engine can't read them
  }
  return clean
}

export function createStrategyTools(store: StrategyStore, backtestEngine?: BacktestEngine) {
  return {
    strategy: tool({
      description: 'Manage trading/risk strategies: add, list, update, delete, refine, or get active strategies.',
      inputSchema: z.object({
        action: z.enum(['add', 'list', 'update', 'delete', 'refine', 'getActive']).describe(
          'add: create new | list: show all | update: modify existing | delete: remove | refine: AI variant | getActive: enabled strategies',
        ),
        id: z.string().optional().describe('Strategy ID (required for update, delete, refine)'),
        name: z.string().optional().describe('Strategy name (required for add, refine)'),
        description: z.string().optional().describe('Strategy description — MUST be in Korean (required for add)'),
        type: z.enum(['trading', 'risk', 'all']).optional().describe('Strategy type (required for add; filter for list)'),
        config: z.record(z.string(), z.unknown()).optional().describe('Strategy parameters as JSON (do NOT put enabled here)'),
        enabled: z.boolean().optional().describe('Enable or disable a strategy (for update action)'),
        parentId: z.string().optional().describe('Parent strategy ID (for refine — use id field instead)'),
        reason: z.string().optional().describe('Reason for refinement (Korean, required for refine)'),
      }),
      execute: async (input) => {
        switch (input.action) {
          case 'add': {
            if (!input.name || !input.description || !input.type || input.type === 'all' || !input.config) {
              return { error: 'name, description, type (trading|risk), and config are required for add' }
            }
            const id = `${input.type}-${Date.now().toString(36)}`
            const now = new Date().toISOString()
            const cleanConfig = sanitizeConfig(input.config)
            store.upsertStrategy({
              id, name: input.name, description: input.description,
              type: input.type, config: cleanConfig, enabled: false,
              createdAt: now, updatedAt: now, source: 'ai', parentId: null,
            })
            const removedKeys = Object.keys(input.config).filter(k => !(k in cleanConfig))
            return {
              success: true, id,
              message: `Strategy "${input.name}" added.`,
              savedConfig: cleanConfig,
              ...(removedKeys.length > 0 ? { warning: `Removed non-numeric keys (engine ignores text): ${removedKeys.join(', ')}` } : {}),
            }
          }

          case 'list': {
            const type = (!input.type || input.type === 'all') ? undefined : input.type
            return { strategies: store.getStrategies(type) }
          }

          case 'update': {
            if (!input.id) return { error: 'id is required for update' }
            const existing = store.getStrategy(input.id)
            if (!existing) return { error: `Strategy "${input.id}" not found.` }
            // Sanitize and merge config
            const inputCfg = input.config ? sanitizeConfig(input.config) : null
            const mergedConfig = inputCfg
              ? { ...existing.config, ...inputCfg }
              : existing.config
            // Handle enabled toggle via DB column, not config
            const newEnabled = input.enabled !== undefined ? input.enabled : existing.enabled
            store.upsertStrategy({
              ...existing,
              name: input.name ?? existing.name,
              description: input.description ?? existing.description,
              config: mergedConfig,
              enabled: newEnabled,
              updatedAt: new Date().toISOString(),
            })
            return { success: true, message: `Strategy "${existing.name}" updated.${input.enabled !== undefined ? ` enabled=${newEnabled}` : ''}` }
          }

          case 'delete': {
            if (!input.id) return { error: 'id is required for delete' }
            store.deleteStrategy(input.id)
            return { success: true, message: 'Strategy deleted.' }
          }

          case 'refine': {
            const parentId = input.id || input.parentId
            if (!parentId || !input.name || !input.description || !input.config || !input.reason) {
              return { error: 'id (parent), name, description, config, and reason are required for refine' }
            }
            const parent = store.getStrategy(parentId)
            if (!parent) return { error: `Parent strategy "${parentId}" not found.` }
            const id = `${parent.type}-refined-${Date.now().toString(36)}`
            const now = new Date().toISOString()
            store.upsertStrategy({
              id, name: input.name,
              description: `${input.description}\n\n📊 Reason: ${input.reason}\n🔗 Based on: ${parent.name}`,
              type: parent.type, config: input.config, enabled: false,
              createdAt: now, updatedAt: now, source: 'ai', parentId,
            })
            return { success: true, id, message: `AI-refined strategy "${input.name}" added.` }
          }

          case 'getActive': {
            return {
              tradingStrategies: store.getEnabledStrategies('trading'),
              riskStrategies: store.getEnabledStrategies('risk'),
            }
          }
        }
      },
    }),

    backtest: tool({
      description: 'Run or query backtests: run a new test, list results, or get detail.',
      inputSchema: z.object({
        action: z.enum(['run', 'list', 'detail']).describe(
          'run: execute backtest | list: past results | detail: specific backtest detail',
        ),
        id: z.string().optional().describe('Backtest ID (required for detail)'),
        name: z.string().optional().describe('Backtest name (required for run)'),
        exchange: z.string().optional().describe('Exchange, e.g. "binance" (required for run)'),
        symbol: z.string().optional().describe('Symbol, e.g. "BTC/USDT" (required for run)'),
        timeframe: z.string().optional().default('1h').describe('Candle timeframe'),
        startDate: z.string().optional().describe('Start date ISO (required for run)'),
        endDate: z.string().optional().describe('End date ISO (required for run)'),
        initialEquity: z.number().optional().default(10000).describe('Initial equity (default $10,000)'),
      }),
      execute: async (input) => {
        switch (input.action) {
          case 'list': {
            return { results: store.getBacktestResults() }
          }

          case 'detail': {
            if (!input.id) return { error: 'id is required for detail' }
            const result = store.getBacktestResult(input.id)
            if (!result) return { error: 'Backtest not found.' }
            const trades = store.getBacktestTrades(input.id)
            return { result, trades }
          }

          case 'run': {
            if (!backtestEngine) return { error: 'Backtest engine not available' }
            if (!input.name || !input.exchange || !input.symbol || !input.startDate || !input.endDate) {
              return { error: 'name, exchange, symbol, startDate, and endDate are required for run' }
            }
            try {
              const btId = await backtestEngine.run({
                name: input.name,
                exchange: input.exchange,
                symbol: input.symbol,
                timeframe: input.timeframe || '1h',
                startDate: input.startDate,
                endDate: input.endDate,
                initialEquity: input.initialEquity,
              })
              const result = store.getBacktestResult(btId)
              if (!result) return { error: 'Backtest failed' }
              if (result.status === 'error') return { error: result.error, id: btId }

              const trades = store.getBacktestTrades(btId)
              return {
                success: true,
                id: btId,
                summary: {
                  totalPnl: result.totalPnl,
                  totalTrades: result.totalTrades,
                  wins: result.wins,
                  losses: result.losses,
                  winRate: result.winRate !== null ? (result.winRate * 100).toFixed(1) + '%' : null,
                },
                strategies: result.strategyIds,
                riskRules: result.riskIds,
                tradeCount: trades.length,
                topTrades: trades.slice(0, 5).map(t => ({
                  symbol: t.symbol, side: t.side,
                  entry: t.entryPrice, exit: t.exitPrice,
                  pnl: t.pnl, time: t.entryTime,
                })),
              }
            } catch (err) {
              return { error: err instanceof Error ? err.message : String(err) }
            }
          }
        }
      },
    }),
  }
}

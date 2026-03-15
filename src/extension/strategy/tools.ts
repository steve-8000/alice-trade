import { tool } from 'ai'
import { z } from 'zod'
import type { StrategyStore } from './store.js'
import type { BacktestEngine } from './backtest-engine.js'

export function createStrategyTools(store: StrategyStore, backtestEngine?: BacktestEngine) {
  return {
    strategyAdd: tool({
      description: 'Add a new trading strategy or risk management strategy. The description MUST be written in Korean.',
      inputSchema: z.object({
        name: z.string().describe('Strategy name (English)'),
        description: z.string().describe('Detailed strategy description (MUST be in Korean)'),
        type: z.enum(['trading', 'risk']).describe('Strategy type: "trading" or "risk"'),
        config: z.record(z.string(), z.unknown()).describe('Strategy parameters as JSON (e.g. {"rsiPeriod": 14, "overbought": 70})'),
      }),
      execute: async (input) => {
        const id = `${input.type}-${Date.now().toString(36)}`
        const now = new Date().toISOString()
        store.upsertStrategy({
          id, name: input.name, description: input.description,
          type: input.type, config: input.config, enabled: false,
          createdAt: now, updatedAt: now, source: 'ai', parentId: null,
        })
        return { success: true, id, message: `Strategy "${input.name}" added. Enable it from the UI.` }
      },
    }),

    strategyList: tool({
      description: 'List registered strategies.',
      inputSchema: z.object({
        type: z.enum(['trading', 'risk', 'all']).optional().default('all').describe('Type filter'),
      }),
      execute: async (input) => {
        const type = input.type === 'all' ? undefined : input.type
        return { strategies: store.getStrategies(type) }
      },
    }),

    strategyUpdate: tool({
      description: 'Update an existing strategy. Description MUST be in Korean.',
      inputSchema: z.object({
        id: z.string().describe('Strategy ID to update'),
        name: z.string().optional().describe('New name'),
        description: z.string().optional().describe('New description (Korean)'),
        config: z.record(z.string(), z.unknown()).optional().describe('New parameters'),
      }),
      execute: async (input) => {
        const existing = store.getStrategy(input.id)
        if (!existing) return { error: `Strategy "${input.id}" not found.` }
        store.upsertStrategy({
          ...existing,
          name: input.name ?? existing.name,
          description: input.description ?? existing.description,
          config: input.config ?? existing.config,
          updatedAt: new Date().toISOString(),
        })
        return { success: true, message: `Strategy "${existing.name}" updated.` }
      },
    }),

    strategyDelete: tool({
      description: 'Delete a strategy.',
      inputSchema: z.object({ id: z.string().describe('Strategy ID') }),
      execute: async (input) => {
        store.deleteStrategy(input.id)
        return { success: true, message: 'Strategy deleted.' }
      },
    }),

    strategyRefine: tool({
      description: 'Create an AI-recommended variant of an existing strategy with fine-tuned parameters based on backtest results. Description MUST be in Korean.',
      inputSchema: z.object({
        parentId: z.string().describe('Original strategy ID'),
        name: z.string().describe('New strategy name'),
        description: z.string().describe('Description of adjustments (Korean)'),
        config: z.record(z.string(), z.unknown()).describe('Adjusted parameters'),
        reason: z.string().describe('Reason for adjustment (Korean)'),
      }),
      execute: async (input) => {
        const parent = store.getStrategy(input.parentId)
        if (!parent) return { error: `Parent strategy "${input.parentId}" not found.` }
        const id = `${parent.type}-refined-${Date.now().toString(36)}`
        const now = new Date().toISOString()
        store.upsertStrategy({
          id, name: input.name,
          description: `${input.description}\n\n📊 Reason: ${input.reason}\n🔗 Based on: ${parent.name}`,
          type: parent.type, config: input.config, enabled: false,
          createdAt: now, updatedAt: now, source: 'ai', parentId: input.parentId,
        })
        return { success: true, id, message: `AI-refined strategy "${input.name}" added.` }
      },
    }),

    strategyGetActive: tool({
      description: 'Get currently enabled trading and risk management strategies.',
      inputSchema: z.object({}),
      execute: async () => ({
        tradingStrategies: store.getEnabledStrategies('trading'),
        riskStrategies: store.getEnabledStrategies('risk'),
      }),
    }),

    backtestGetResults: tool({
      description: 'List past backtest results.',
      inputSchema: z.object({}),
      execute: async () => ({ results: store.getBacktestResults() }),
    }),

    backtestGetDetail: tool({
      description: 'Get detailed results and trade log for a specific backtest.',
      inputSchema: z.object({ id: z.string().describe('Backtest ID') }),
      execute: async (input) => {
        const result = store.getBacktestResult(input.id)
        if (!result) return { error: 'Backtest not found.' }
        const trades = store.getBacktestTrades(input.id)
        return { result, trades }
      },
    }),

    backtestRun: tool({
      description: 'Run a backtest using the code-based engine. Uses currently active trading strategies and risk management rules to simulate trades against historical candle data from the database.',
      inputSchema: z.object({
        name: z.string().describe('Backtest name'),
        exchange: z.string().describe('Exchange (e.g. "binance")'),
        symbol: z.string().describe('Symbol to test (e.g. "BTC/USDT")'),
        timeframe: z.string().default('1h').describe('Candle timeframe'),
        startDate: z.string().describe('Start date (ISO)'),
        endDate: z.string().describe('End date (ISO)'),
        initialEquity: z.number().optional().default(10000).describe('Initial equity for simulation (default $10,000)'),
      }),
      execute: async (input) => {
        if (!backtestEngine) return { error: 'Backtest engine not available' }
        try {
          const btId = await backtestEngine.run({
            name: input.name,
            exchange: input.exchange,
            symbol: input.symbol,
            timeframe: input.timeframe,
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
      },
    }),
  }
}

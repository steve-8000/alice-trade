import { tool } from 'ai'
import { z } from 'zod'
import type { StrategyStore } from './store.js'

export function createStrategyTools(store: StrategyStore) {
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
      description: 'Run a backtest by simulating trades against historical candle data using the active strategies. First fetch candles via marketDataGetCandles, simulate entries/exits, then call this tool to record results.',
      inputSchema: z.object({
        name: z.string().describe('Backtest name'),
        exchange: z.string().describe('Exchange (e.g. "binance")'),
        symbols: z.array(z.string()).describe('Symbols to test'),
        timeframe: z.string().default('1h').describe('Candle timeframe'),
        startDate: z.string().describe('Start date (ISO)'),
        endDate: z.string().describe('End date (ISO)'),
        trades: z.array(z.object({
          symbol: z.string(),
          side: z.enum(['buy', 'sell']),
          entryPrice: z.number(),
          exitPrice: z.number(),
          quantity: z.number(),
          entryTime: z.string(),
          exitTime: z.string(),
          pnl: z.number(),
        })).describe('Simulated trade records'),
        dailyPnl: z.record(z.string(), z.number()).optional().describe('Daily PNL map'),
        weeklyPnl: z.record(z.string(), z.number()).optional().describe('Weekly PNL map'),
        monthlyPnl: z.record(z.string(), z.number()).optional().describe('Monthly PNL map'),
      }),
      execute: async (input) => {
        const id = `bt-${Date.now().toString(36)}`
        const now = new Date().toISOString()
        const activeStrategies = store.getEnabledStrategies('trading')
        const activeRisk = store.getEnabledStrategies('risk')

        const wins = input.trades.filter(t => t.pnl > 0).length
        const losses = input.trades.filter(t => t.pnl <= 0).length
        const totalPnl = input.trades.reduce((s, t) => s + t.pnl, 0)

        store.insertBacktest({
          id, name: input.name, exchange: input.exchange,
          symbols: input.symbols, timeframe: input.timeframe,
          startDate: input.startDate, endDate: input.endDate,
          strategyIds: activeStrategies.map(s => s.id),
          riskIds: activeRisk.map(s => s.id),
          status: 'completed', createdAt: now,
          totalPnl, totalTrades: input.trades.length,
          wins, losses, winRate: input.trades.length > 0 ? wins / input.trades.length : 0,
          dailyPnl: input.dailyPnl || null,
          weeklyPnl: input.weeklyPnl || null,
          monthlyPnl: input.monthlyPnl || null,
          error: null,
        })

        const backtestTrades = input.trades.map((t, i) => ({
          id: `${id}-t${i}`, backtestId: id,
          symbol: t.symbol, side: t.side as 'buy' | 'sell',
          entryPrice: t.entryPrice, exitPrice: t.exitPrice,
          quantity: t.quantity, entryTime: t.entryTime, exitTime: t.exitTime,
          pnl: t.pnl, status: 'closed' as const,
        }))
        store.insertTrades(backtestTrades)

        return {
          success: true, id,
          summary: { totalPnl, totalTrades: input.trades.length, wins, losses, winRate: input.trades.length > 0 ? (wins / input.trades.length * 100).toFixed(1) + '%' : '0%' },
        }
      },
    }),
  }
}

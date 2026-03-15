import { tool } from 'ai'
import { z } from 'zod'
import type { MarketDataStore } from './store.js'

export function createMarketDataTools(store: MarketDataStore) {
  return {
    marketDataGetCandles: tool({
      description: 'Get historical OHLCV candle data from the market data database. Returns up to 100 candles with summary statistics. For backtesting, use the backtestRun tool instead.',
      inputSchema: z.object({
        exchange: z.string().describe('Exchange name, e.g. "binance" or "bybit"'),
        symbol: z.string().describe('Trading pair, e.g. "BTC/USDT"'),
        timeframe: z.string().default('1h').describe('Candle timeframe, e.g. "1m", "5m", "1h", "4h", "1d"'),
        since: z.string().optional().describe('Start date ISO string or unix ms'),
        until: z.string().optional().describe('End date ISO string or unix ms'),
        limit: z.number().optional().default(100).describe('Max candles to return (max 200)'),
      }),
      execute: async (input) => {
        const sinceMs = input.since ? (isNaN(Number(input.since)) ? new Date(input.since).getTime() : Number(input.since)) : undefined
        const untilMs = input.until ? (isNaN(Number(input.until)) ? new Date(input.until).getTime() : Number(input.until)) : undefined
        const limit = Math.min(input.limit || 100, 200)
        const candles = store.getCandles(input.exchange, input.symbol, input.timeframe, sinceMs, untilMs, limit)
        if (!candles.length) return { error: `No candle data found for ${input.exchange}/${input.symbol}/${input.timeframe}` }
        const range = store.getDateRange(input.exchange, input.symbol, input.timeframe)
        const totalAvailable = store.getCandleCount(input.exchange, input.symbol, input.timeframe)
        const closes = candles.map(c => c.close)
        const highs = candles.map(c => c.high)
        const lows = candles.map(c => c.low)
        const vols = candles.map(c => c.volume)
        return {
          exchange: input.exchange, symbol: input.symbol, timeframe: input.timeframe,
          returned: candles.length, totalAvailable,
          dataRange: {
            oldest: range.oldest ? new Date(range.oldest).toISOString() : null,
            newest: range.newest ? new Date(range.newest).toISOString() : null,
          },
          summary: {
            high: Math.max(...highs), low: Math.min(...lows),
            open: candles[0].open, close: candles[candles.length - 1].close,
            avgVolume: vols.reduce((a, b) => a + b, 0) / vols.length,
            change: ((closes[closes.length - 1] - closes[0]) / closes[0] * 100).toFixed(2) + '%',
          },
          candles: candles.map(c => ({
            t: new Date(c.timestamp).toISOString().slice(0, 16),
            o: c.open, h: c.high, l: c.low, c: c.close, v: Math.round(c.volume),
          })),
        }
      },
    }),

    marketDataGetLatestPrice: tool({
      description: 'Get the latest price for a symbol from the market data database.',
      inputSchema: z.object({
        exchange: z.string().describe('Exchange name, e.g. "binance"'),
        symbol: z.string().describe('Trading pair, e.g. "BTC/USDT"'),
      }),
      execute: async (input) => {
        const candle = store.getLatestCandle(input.exchange, input.symbol, '1m')
          || store.getLatestCandle(input.exchange, input.symbol, '5m')
          || store.getLatestCandle(input.exchange, input.symbol, '1h')
        if (!candle) return { error: `No data for ${input.exchange}/${input.symbol}` }
        return {
          exchange: input.exchange, symbol: input.symbol,
          price: candle.close, high: candle.high, low: candle.low,
          volume: candle.volume,
          time: new Date(candle.timestamp).toISOString(),
          timeframe: candle.timeframe,
        }
      },
    }),

    marketDataGetStatus: tool({
      description: 'Get the status of all market data connections and available data.',
      inputSchema: z.object({}),
      execute: async () => {
        const connections = store.getConnections()
        return {
          connections: connections.map(c => ({
            id: c.id, exchange: c.exchange, symbols: c.symbols,
            timeframes: c.timeframes, historyDays: c.historyDays,
            enabled: c.enabled, status: c.status,
            firstBuilt: c.firstBuilt, lastUpdate: c.lastUpdate, error: c.error,
            data: c.symbols.map(sym => {
              const counts: Record<string, number> = {}
              for (const tf of c.timeframes) counts[tf] = store.getCandleCount(c.exchange, sym, tf)
              return { symbol: sym, candleCounts: counts }
            }),
          })),
        }
      },
    }),

    marketDataGetSummary: tool({
      description: 'Get a statistical summary of candle data for a symbol (OHLCV stats, date range, count).',
      inputSchema: z.object({
        exchange: z.string().describe('Exchange name'),
        symbol: z.string().describe('Trading pair'),
        timeframe: z.string().default('1h').describe('Timeframe'),
        period: z.string().optional().default('24h').describe('Lookback period, e.g. "24h", "7d", "30d"'),
      }),
      execute: async (input) => {
        const periodMs = parsePeriod(input.period || '24h')
        const since = Date.now() - periodMs
        const candles = store.getCandles(input.exchange, input.symbol, input.timeframe, since, undefined, 10000)
        if (!candles.length) return { error: `No data for ${input.exchange}/${input.symbol}/${input.timeframe}` }

        const closes = candles.map(c => c.close)
        const volumes = candles.map(c => c.volume)
        const highs = candles.map(c => c.high)
        const lows = candles.map(c => c.low)

        return {
          exchange: input.exchange, symbol: input.symbol, timeframe: input.timeframe,
          period: input.period || '24h', candleCount: candles.length,
          priceRange: { high: Math.max(...highs), low: Math.min(...lows) },
          latestClose: closes[closes.length - 1], firstClose: closes[0],
          changePercent: ((closes[closes.length - 1] - closes[0]) / closes[0] * 100).toFixed(2) + '%',
          avgVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length,
          totalVolume: volumes.reduce((a, b) => a + b, 0),
          dateRange: {
            from: new Date(candles[0].timestamp).toISOString(),
            to: new Date(candles[candles.length - 1].timestamp).toISOString(),
          },
        }
      },
    }),
  }
}

function parsePeriod(s: string): number {
  const m = s.match(/^(\d+)(m|h|d|w)$/)
  if (!m) return 86_400_000
  const n = parseInt(m[1])
  switch (m[2]) {
    case 'm': return n * 60_000
    case 'h': return n * 3_600_000
    case 'd': return n * 86_400_000
    case 'w': return n * 604_800_000
    default: return 86_400_000
  }
}

import { sma, ema, rsi, macd, bollingerBands, crossesAbove, crossesBelow, waveTrend, stochRsi, rsiMfi } from './indicators.js'
import type { MarketDataStore, Candle } from '../market-data/store.js'
import type { StrategyStore, Strategy, BacktestTrade } from './store.js'

export interface BacktestConfig {
  name: string
  exchange: string
  symbol: string
  timeframe: string
  startDate: string  // ISO
  endDate: string    // ISO
  initialEquity?: number  // default 10000
}

interface Position {
  side: 'long' | 'short'
  entryPrice: number
  entryTime: string
  quantity: number
  stopLoss: number | null
  takeProfit: number | null
}

interface RiskParams {
  stopLossPercent: number
  takeProfitPercent: number
  maxPositionSizePercent: number
  trailingStopPercent: number | null
  dailyLossLimitPct: number
  maxConsecutiveLosses: number
  cooldownBars: number
  maxOpenPositions: number
  riskPerTradePct: number
  halfSizeFactor: number
}

export class BacktestEngine {
  constructor(
    private marketDataStore: MarketDataStore,
    private strategyStore: StrategyStore,
  ) {}

  private buildConfigSnapshot(strategies: Strategy[]): Record<string, { name: string; config: Record<string, unknown> }> {
    const snapshot: Record<string, { name: string; config: Record<string, unknown> }> = {}
    for (const s of strategies) snapshot[s.id] = { name: s.name, config: s.config }
    return snapshot
  }

  async run(config: BacktestConfig): Promise<string> {
    const id = `bt-${Date.now().toString(36)}`
    const now = new Date().toISOString()

    const tradingStrategies = this.strategyStore.getEnabledStrategies('trading')
    const riskStrategies = this.strategyStore.getEnabledStrategies('risk')
    const strategyConfigs = this.buildConfigSnapshot([...tradingStrategies, ...riskStrategies])

    if (tradingStrategies.length === 0) {
      this.strategyStore.insertBacktest({
        id, name: config.name, exchange: config.exchange,
        symbols: [config.symbol], timeframe: config.timeframe,
        startDate: config.startDate, endDate: config.endDate,
        strategyIds: [], riskIds: riskStrategies.map(s => s.id),
        strategyConfigs,
        status: 'error', createdAt: now,
        totalPnl: null, totalTrades: null, wins: null, losses: null, winRate: null,
        dailyPnl: null, weeklyPnl: null, monthlyPnl: null,
        error: 'No active trading strategies',
      })
      return id
    }

    // Load candles
    const since = new Date(config.startDate).getTime()
    const until = new Date(config.endDate).getTime()
    const candles = this.marketDataStore.getCandles(
      config.exchange, config.symbol, config.timeframe, since, until, 100000
    )

    if (candles.length < 50) {
      this.strategyStore.insertBacktest({
        id, name: config.name, exchange: config.exchange,
        symbols: [config.symbol], timeframe: config.timeframe,
        startDate: config.startDate, endDate: config.endDate,
        strategyIds: tradingStrategies.map(s => s.id),
        riskIds: riskStrategies.map(s => s.id),
        strategyConfigs,
        status: 'error', createdAt: now,
        totalPnl: null, totalTrades: null, wins: null, losses: null, winRate: null,
        dailyPnl: null, weeklyPnl: null, monthlyPnl: null,
        error: `Not enough candle data (${candles.length} candles, need at least 50)`,
      })
      return id
    }

    // Generate signals from each strategy
    const closes = candles.map(c => c.close)
    const highs = candles.map(c => c.high)
    const lows = candles.map(c => c.low)

    // Combine signals from all active trading strategies
    const signals = this.generateSignals(candles, closes, highs, lows, tradingStrategies)

    // Get risk parameters (merge risk strategies + strategy-level SL/TP)
    const riskParams = this.getRiskParams(riskStrategies)

    // Apply strategy-level SL/TP if defined (most conservative wins)
    const strategySLTP = this.getStrategySLTP(tradingStrategies)

    // Simulate trades
    const initialEquity = config.initialEquity ?? 10000
    const trades = this.simulateTrades(candles, signals, riskParams, strategySLTP, initialEquity)

    // Calculate PNL breakdowns
    const { dailyPnl, weeklyPnl, monthlyPnl } = this.calculatePnlBreakdowns(trades)

    const wins = trades.filter(t => (t.pnl ?? 0) > 0).length
    const losses = trades.filter(t => (t.pnl ?? 0) <= 0).length
    const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0)

    // Save results
    this.strategyStore.insertBacktest({
      id, name: config.name, exchange: config.exchange,
      symbols: [config.symbol], timeframe: config.timeframe,
      startDate: config.startDate, endDate: config.endDate,
      strategyIds: tradingStrategies.map(s => s.id),
      riskIds: riskStrategies.map(s => s.id),
      strategyConfigs,
      status: 'completed', createdAt: now,
      totalPnl, totalTrades: trades.length, wins, losses,
      winRate: trades.length > 0 ? wins / trades.length : 0,
      dailyPnl, weeklyPnl, monthlyPnl, error: null,
    })

    // Save individual trades
    const backtestTrades: BacktestTrade[] = trades.map((t, i) => ({
      id: `${id}-t${i}`,
      backtestId: id,
      ...t,
    }))
    this.strategyStore.insertTrades(backtestTrades)

    return id
  }

  /**
   * Config-key-driven signal generation.
   * Detects which indicators to use based on config keys present.
   * Multiple indicators act as filters (AND logic) — entry only when all agree.
   */
  private generateSignals(
    candles: Candle[],
    closes: number[],
    _highs: number[],
    _lows: number[],
    strategies: Strategy[],
  ): Array<'long' | 'short' | 'close_long' | 'close_short' | null> {
    const signals: Array<'long' | 'short' | 'close_long' | 'close_short' | null> = new Array(candles.length).fill(null)
    const volumes = candles.map(c => (c as any).volume ?? 0)
    const hlc3 = candles.map(c => (c.high + c.low + c.close) / 3)

    for (const strategy of strategies) {
      const cfg = strategy.config as Record<string, any>

      // Determine which indicators are active based on config keys
      const useWT = cfg.wtChannelLen !== undefined || cfg.obLevel !== undefined || cfg.osLevel !== undefined
        || strategy.name.toLowerCase().includes('vmc') || strategy.name.toLowerCase().includes('wavetrend')
      const useRSI = cfg.rsiPeriod !== undefined || cfg.rsiOverbought !== undefined || cfg.rsiOversold !== undefined
      const useStochRSI = cfg.stochLen !== undefined || cfg.stochRsiLen !== undefined
      const useEMA = cfg.fastEma !== undefined || cfg.slowEma !== undefined
      const useMACD = cfg.macdFastPeriod !== undefined || cfg.macdSlowPeriod !== undefined
      const useBB = cfg.bbPeriod !== undefined
      const useMFI = cfg.useMfiFilter === true || cfg.mfiPeriod !== undefined

      // If no indicator detected, default to WaveTrend
      const noIndicator = !useWT && !useRSI && !useStochRSI && !useEMA && !useMACD && !useBB

      // Pre-compute all needed indicators
      const wt = (useWT || noIndicator) ? waveTrend(hlc3, cfg.wtChannelLen || 9, cfg.wtAverageLen || 12, cfg.wtMALen || 3) : null
      const wtOb = cfg.obLevel || 53
      const wtOs = cfg.osLevel || -53

      const rsiValues = useRSI ? rsi(closes, cfg.rsiPeriod || 14) : null
      const rsiOb = cfg.rsiOverbought || cfg.overbought || 70
      const rsiOs = cfg.rsiOversold || cfg.oversold || 30

      const stoch = useStochRSI ? stochRsi(closes, cfg.stochRsiLen || 14, cfg.stochLen || 14, cfg.kSmooth || 3, cfg.dSmooth || 3) : null
      const stochOb = cfg.stochOverbought || 80
      const stochOs = cfg.stochOversold || 20

      const emaFast = useEMA ? ema(closes, cfg.fastEma || 9) : null
      const emaSlow = useEMA ? ema(closes, cfg.slowEma || 21) : null

      const macdData = useMACD ? macd(closes, cfg.macdFastPeriod || 12, cfg.macdSlowPeriod || 26, cfg.macdSignalPeriod || 9) : null

      const bbData = useBB ? bollingerBands(closes, cfg.bbPeriod || 20, cfg.bbStdDev || 2) : null

      const mfiValues = useMFI ? rsiMfi(closes, volumes, cfg.mfiPeriod || 60) : null

      const cooldown = cfg.cooldownBars || 0
      let lastEntry = -Infinity

      for (let i = 1; i < candles.length; i++) {
        // Cooldown check
        if ((i - lastEntry) < cooldown) continue

        let longVotes = 0, shortVotes = 0, closeLongVotes = 0, closeShortVotes = 0
        let totalIndicators = 0

        // --- WaveTrend ---
        if (wt) {
          totalIndicators++
          if (wt.wt1[i] === null || wt.wt2[i] === null) continue
          const crossUp = crossesAbove(wt.wt1, wt.wt2, i)
          const crossDown = crossesBelow(wt.wt1, wt.wt2, i)
          const oversold = wt.wt1[i]! < wtOs || wt.wt2[i]! < wtOs
          const overbought = wt.wt1[i]! > wtOb || wt.wt2[i]! > wtOb

          if (crossUp && oversold) longVotes++
          if (crossDown && overbought) shortVotes++
          if (crossDown && !overbought) closeLongVotes++
          if (crossUp && !oversold) closeShortVotes++
        }

        // --- RSI filter ---
        if (rsiValues && rsiValues[i] !== null) {
          totalIndicators++
          if (rsiValues[i]! < rsiOs) longVotes++
          if (rsiValues[i]! > rsiOb) shortVotes++
          if (rsiValues[i]! > rsiOb) closeLongVotes++
          if (rsiValues[i]! < rsiOs) closeShortVotes++
        }

        // --- StochRSI ---
        if (stoch && stoch.k[i] !== null && stoch.d[i] !== null) {
          totalIndicators++
          if (crossesAbove(stoch.k, stoch.d, i) && stoch.k[i]! < stochOs) longVotes++
          if (crossesBelow(stoch.k, stoch.d, i) && stoch.k[i]! > stochOb) shortVotes++
        }

        // --- EMA Crossover ---
        if (emaFast && emaSlow) {
          totalIndicators++
          if (crossesAbove(emaFast, emaSlow, i)) longVotes++
          if (crossesBelow(emaFast, emaSlow, i)) { shortVotes++; closeLongVotes++ }
        }

        // --- MACD ---
        if (macdData) {
          totalIndicators++
          if (crossesAbove(macdData.macd, macdData.signal, i)) longVotes++
          if (crossesBelow(macdData.macd, macdData.signal, i)) { shortVotes++; closeLongVotes++ }
        }

        // --- Bollinger Bands ---
        if (bbData && bbData.lower[i] !== null && bbData.upper[i] !== null) {
          totalIndicators++
          if (closes[i] <= bbData.lower[i]! && closes[i - 1] > (bbData.lower[i - 1] ?? closes[i - 1])) longVotes++
          if (closes[i] >= bbData.upper[i]! && closes[i - 1] < (bbData.upper[i - 1] ?? closes[i - 1])) { shortVotes++; closeLongVotes++ }
        }

        // --- MFI filter (reduces votes if trend disagrees) ---
        if (mfiValues && mfiValues[i] !== null && i > 1 && mfiValues[i - 1] !== null) {
          if (mfiValues[i]! < mfiValues[i - 1]!) longVotes = Math.max(0, longVotes - 1)
          if (mfiValues[i]! > mfiValues[i - 1]!) shortVotes = Math.max(0, shortVotes - 1)
        }

        // --- Determine signal: require majority or at least 1 if only 1 indicator ---
        const threshold = cfg.minSignalStrength || (totalIndicators === 1 ? 1 : Math.ceil(totalIndicators * 0.5))

        if (cfg.allowLong !== false && longVotes >= threshold && !signals[i]) {
          signals[i] = 'long'; lastEntry = i
        } else if (cfg.allowShort !== false && shortVotes >= threshold && !signals[i]) {
          signals[i] = 'short'; lastEntry = i
        } else if (closeLongVotes > 0 && !signals[i]) {
          signals[i] = 'close_long'
        } else if (closeShortVotes > 0 && !signals[i]) {
          signals[i] = 'close_short'
        }
      }
    }

    return signals
  }

  private getRiskParams(riskStrategies: Strategy[]): RiskParams {
    let params: RiskParams = {
      stopLossPercent: 5,
      takeProfitPercent: 10,
      maxPositionSizePercent: 100,
      trailingStopPercent: null,
      dailyLossLimitPct: 100,
      maxConsecutiveLosses: 999,
      cooldownBars: 0,
      maxOpenPositions: 10,
      riskPerTradePct: 100,
      halfSizeFactor: 1.0,
    }

    for (const rs of riskStrategies) {
      const cfg = rs.config as Record<string, any>
      if (cfg.stopPct !== undefined) params.stopLossPercent = Math.min(params.stopLossPercent, cfg.stopPct)
      if (cfg.stopLossPercent !== undefined) params.stopLossPercent = Math.min(params.stopLossPercent, cfg.stopLossPercent)
      if (cfg.stopLoss !== undefined) params.stopLossPercent = Math.min(params.stopLossPercent, cfg.stopLoss)
      if (cfg.takePct !== undefined) params.takeProfitPercent = Math.min(params.takeProfitPercent, cfg.takePct)
      if (cfg.takeProfitPercent !== undefined) params.takeProfitPercent = Math.min(params.takeProfitPercent, cfg.takeProfitPercent)
      if (cfg.takeProfit !== undefined) params.takeProfitPercent = Math.min(params.takeProfitPercent, cfg.takeProfit)
      if (cfg.maxPositionSizePercent !== undefined) params.maxPositionSizePercent = Math.min(params.maxPositionSizePercent, cfg.maxPositionSizePercent)
      if (cfg.trailingStopPercent !== undefined) params.trailingStopPercent = cfg.trailingStopPercent
      if (cfg.dailyLossLimitPct !== undefined) params.dailyLossLimitPct = Math.min(params.dailyLossLimitPct, cfg.dailyLossLimitPct)
      if (cfg.maxConsecutiveLosses !== undefined) params.maxConsecutiveLosses = Math.min(params.maxConsecutiveLosses, cfg.maxConsecutiveLosses)
      if (cfg.cooldownBars !== undefined) params.cooldownBars = Math.max(params.cooldownBars, cfg.cooldownBars)
      if (cfg.maxOpenPositions !== undefined) params.maxOpenPositions = Math.min(params.maxOpenPositions, cfg.maxOpenPositions)
      if (cfg.riskPerTradePct !== undefined) params.riskPerTradePct = Math.min(params.riskPerTradePct, cfg.riskPerTradePct)
      if (cfg.halfSizeFactor !== undefined) params.halfSizeFactor = Math.min(params.halfSizeFactor, cfg.halfSizeFactor)
    }

    return params
  }

  /** Extract strategy-level SL/TP from trading strategies (most conservative wins) */
  private getStrategySLTP(tradingStrategies: Strategy[]): { stopPct: number | null; takePct: number | null } {
    let stopPct: number | null = null
    let takePct: number | null = null

    for (const s of tradingStrategies) {
      const cfg = s.config as Record<string, any>
      if (cfg.stopPct !== undefined) {
        stopPct = stopPct === null ? cfg.stopPct : Math.min(stopPct, cfg.stopPct)
      }
      if (cfg.takePct !== undefined) {
        takePct = takePct === null ? cfg.takePct : Math.min(takePct, cfg.takePct)
      }
    }

    return { stopPct, takePct }
  }

  private simulateTrades(
    candles: Candle[],
    signals: Array<'long' | 'short' | 'close_long' | 'close_short' | null>,
    risk: RiskParams,
    strategySLTP: { stopPct: number | null; takePct: number | null },
    initialEquity: number,
  ): Array<Omit<BacktestTrade, 'id' | 'backtestId'>> {
    const trades: Array<Omit<BacktestTrade, 'id' | 'backtestId'>> = []
    const positions: Position[] = []
    let equity = initialEquity

    // Risk tracking state
    let consecutiveLosses = 0
    let cooldownRemaining = 0
    let dailyPnl = 0
    let currentDay = ''
    let sessionHighEquity = initialEquity
    let halted = false

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i]
      const time = new Date(candle.timestamp).toISOString()
      const day = time.slice(0, 10)

      // Reset daily PnL tracker on new day
      if (day !== currentDay) {
        currentDay = day
        dailyPnl = 0
      }

      // Decrement cooldown
      if (cooldownRemaining > 0) cooldownRemaining--

      // Check SL/TP on existing positions (iterate backwards for safe removal)
      for (let p = positions.length - 1; p >= 0; p--) {
        const position = positions[p]
        let exitReason: string | null = null
        let exitPrice = candle.close

        if (position.side === 'long') {
          if (position.stopLoss && candle.low <= position.stopLoss) {
            exitPrice = position.stopLoss
            exitReason = 'stop_loss'
          }
          if (position.takeProfit && candle.high >= position.takeProfit) {
            exitPrice = position.takeProfit
            exitReason = 'take_profit'
          }
        } else {
          if (position.stopLoss && candle.high >= position.stopLoss) {
            exitPrice = position.stopLoss
            exitReason = 'stop_loss'
          }
          if (position.takeProfit && candle.low <= position.takeProfit) {
            exitPrice = position.takeProfit
            exitReason = 'take_profit'
          }
        }

        if (exitReason) {
          const pnl = position.side === 'long'
            ? (exitPrice - position.entryPrice) * position.quantity
            : (position.entryPrice - exitPrice) * position.quantity
          equity += pnl
          dailyPnl += pnl

          // Track consecutive losses
          if (pnl <= 0) {
            consecutiveLosses++
            if (consecutiveLosses >= risk.maxConsecutiveLosses) {
              cooldownRemaining = risk.cooldownBars
            }
          } else {
            consecutiveLosses = 0
          }

          // Track session high for drawdown halt
          if (equity > sessionHighEquity) sessionHighEquity = equity

          trades.push({
            symbol: candle.symbol,
            side: position.side === 'long' ? 'buy' : 'sell',
            entryPrice: position.entryPrice,
            exitPrice,
            quantity: position.quantity,
            entryTime: position.entryTime,
            exitTime: time,
            pnl,
            status: 'closed',
          })
          positions.splice(p, 1)
        }
      }

      // Check daily loss limit
      const dailyLossLimit = initialEquity * (risk.dailyLossLimitPct / 100)
      if (dailyPnl < -dailyLossLimit) {
        halted = true
      }
      // Reset halt on new day (already handled by dailyPnl reset above)
      if (day !== currentDay) halted = false

      // Process signals
      const signal = signals[i]
      if (!signal) continue

      // Close signals
      if (signal === 'close_long' || signal === 'close_short') {
        const targetSide = signal === 'close_long' ? 'long' : 'short'
        for (let p = positions.length - 1; p >= 0; p--) {
          if (positions[p].side !== targetSide) continue
          const position = positions[p]
          const exitPrice = candle.close
          const pnl = position.side === 'long'
            ? (exitPrice - position.entryPrice) * position.quantity
            : (position.entryPrice - exitPrice) * position.quantity
          equity += pnl
          dailyPnl += pnl

          if (pnl <= 0) {
            consecutiveLosses++
            if (consecutiveLosses >= risk.maxConsecutiveLosses) {
              cooldownRemaining = risk.cooldownBars
            }
          } else {
            consecutiveLosses = 0
          }

          if (equity > sessionHighEquity) sessionHighEquity = equity

          trades.push({
            symbol: candle.symbol,
            side: position.side === 'long' ? 'buy' : 'sell',
            entryPrice: position.entryPrice,
            exitPrice,
            quantity: position.quantity,
            entryTime: position.entryTime,
            exitTime: time,
            pnl,
            status: 'closed',
          })
          positions.splice(p, 1)
        }
      }

      // Entry signals — check all risk rules before allowing
      if ((signal === 'long' || signal === 'short') && !halted) {
        // Max open positions check
        if (positions.length >= risk.maxOpenPositions) continue

        // Cooldown check
        if (cooldownRemaining > 0) continue

        // Pyramiding check: don't open same-side position if one exists (single position per side)
        const sameDirectionOpen = positions.some(p => p.side === signal)
        if (sameDirectionOpen) continue

        const entryPrice = candle.close

        // Position sizing: risk-based
        let sizeEquity = equity * (risk.riskPerTradePct / 100) * (risk.maxPositionSizePercent / 100)

        // Half-size factor on drawdown
        if (equity < sessionHighEquity * 0.95) {
          sizeEquity *= risk.halfSizeFactor
        }

        const positionSize = sizeEquity / entryPrice
        const quantity = Math.max(positionSize, 0.001)

        // Determine SL/TP: merge risk params + strategy-level (most conservative)
        let effectiveSlPct = risk.stopLossPercent
        let effectiveTpPct = risk.takeProfitPercent

        if (strategySLTP.stopPct !== null) {
          effectiveSlPct = Math.min(effectiveSlPct, strategySLTP.stopPct)
        }
        if (strategySLTP.takePct !== null) {
          effectiveTpPct = Math.min(effectiveTpPct, strategySLTP.takePct)
        }

        let stopLoss: number | null = null
        let takeProfit: number | null = null

        if (signal === 'long') {
          stopLoss = entryPrice * (1 - effectiveSlPct / 100)
          takeProfit = entryPrice * (1 + effectiveTpPct / 100)
        } else {
          stopLoss = entryPrice * (1 + effectiveSlPct / 100)
          takeProfit = entryPrice * (1 - effectiveTpPct / 100)
        }

        positions.push({
          side: signal,
          entryPrice,
          entryTime: time,
          quantity,
          stopLoss,
          takeProfit,
        })
      }
    }

    // Close any remaining positions at last candle
    if (positions.length > 0 && candles.length > 0) {
      const lastCandle = candles[candles.length - 1]
      const exitTime = new Date(lastCandle.timestamp).toISOString()
      for (const position of positions) {
        const exitPrice = lastCandle.close
        const pnl = position.side === 'long'
          ? (exitPrice - position.entryPrice) * position.quantity
          : (position.entryPrice - exitPrice) * position.quantity
        trades.push({
          symbol: lastCandle.symbol,
          side: position.side === 'long' ? 'buy' : 'sell',
          entryPrice: position.entryPrice,
          exitPrice,
          quantity: position.quantity,
          entryTime: position.entryTime,
          exitTime,
          pnl,
          status: 'closed',
        })
      }
    }

    return trades
  }

  private calculatePnlBreakdowns(trades: Array<Omit<BacktestTrade, 'id' | 'backtestId'>>): {
    dailyPnl: Record<string, number>
    weeklyPnl: Record<string, number>
    monthlyPnl: Record<string, number>
  } {
    const dailyPnl: Record<string, number> = {}
    const weeklyPnl: Record<string, number> = {}
    const monthlyPnl: Record<string, number> = {}

    for (const t of trades) {
      if (!t.exitTime || t.pnl === null) continue
      const date = new Date(t.exitTime)
      const dayKey = date.toISOString().slice(0, 10)
      const monthKey = date.toISOString().slice(0, 7)

      // Week key (ISO week)
      const d = new Date(date)
      d.setDate(d.getDate() - d.getDay() + 1) // Monday
      const weekKey = d.toISOString().slice(0, 10)

      dailyPnl[dayKey] = (dailyPnl[dayKey] || 0) + t.pnl
      weeklyPnl[weekKey] = (weeklyPnl[weekKey] || 0) + t.pnl
      monthlyPnl[monthKey] = (monthlyPnl[monthKey] || 0) + t.pnl
    }

    return { dailyPnl, weeklyPnl, monthlyPnl }
  }
}

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

  private generateSignals(
    candles: Candle[],
    closes: number[],
    highs: number[],
    lows: number[],
    strategies: Strategy[],
  ): Array<'long' | 'short' | 'close_long' | 'close_short' | null> {
    const signals: Array<'long' | 'short' | 'close_long' | 'close_short' | null> = new Array(candles.length).fill(null)

    for (const strategy of strategies) {
      const cfg = strategy.config as Record<string, any>
      const strategyType = (cfg.strategyType || cfg.type || strategy.name).toLowerCase()

      // --- WaveTrend (VuManChu B) ---
      if (strategyType.includes('wavetrend') || strategyType.includes('vmc') || strategyType.includes('vumanchu') || cfg.wtChannelLen) {
        const channelLen = cfg.wtChannelLen || 9
        const averageLen = cfg.wtAverageLen || 12
        const maLen = cfg.wtMALen || 3
        const obLevel = cfg.obLevel || 53
        const osLevel = cfg.osLevel || -53

        // Calculate HLC3
        const hlc3 = candles.map(c => (c.high + c.low + c.close) / 3)
        const { wt1, wt2 } = waveTrend(hlc3, channelLen, averageLen, maLen)

        // Optional filters
        const volumes = candles.map(c => (c as any).volume ?? 0)
        const mfiPeriod = cfg.mfiPeriod || 60
        const mfiValues = (volumes.some(v => v > 0)) ? rsiMfi(closes, volumes, mfiPeriod) : null

        // Cooldown between entries (strategy-level)
        const entryCooldown = cfg.cooldownBars || 0
        let lastEntryBar = -Infinity

        for (let i = 1; i < candles.length; i++) {
          if (wt1[i] === null || wt2[i] === null) continue

          // Long: WT crosses above in oversold zone
          const wtCrossUp = crossesAbove(wt1, wt2, i)
          const inOversold = (wt1[i]! < osLevel || wt2[i]! < osLevel)

          // Short: WT crosses below in overbought zone
          const wtCrossDown = crossesBelow(wt1, wt2, i)
          const inOverbought = (wt1[i]! > obLevel || wt2[i]! > obLevel)

          // MFI trend filter: skip long if MFI trending down, skip short if MFI trending up
          let mfiAllowLong = true
          let mfiAllowShort = true
          if (mfiValues && cfg.useMfiFilter && i > 1) {
            const mfiCurr = mfiValues[i]
            const mfiPrev = mfiValues[i - 1]
            if (mfiCurr !== null && mfiPrev !== null) {
              if (mfiCurr < mfiPrev) mfiAllowLong = false
              if (mfiCurr > mfiPrev) mfiAllowShort = false
            }
          }

          // Gold buy exclusion: skip long entries on gold symbols
          const symbol = candles[i].symbol?.toUpperCase() || ''
          const isGold = symbol.includes('XAU') || symbol.includes('GOLD')
          const goldBuyExclusion = cfg.goldBuyExclusion && isGold

          // Cooldown check
          const cooledDown = (i - lastEntryBar) >= entryCooldown

          if (wtCrossUp && inOversold && cfg.allowLong !== false && mfiAllowLong && !goldBuyExclusion && cooledDown) {
            if (!signals[i]) { signals[i] = 'long'; lastEntryBar = i }
          }
          if (wtCrossDown && inOverbought && cfg.allowShort !== false && mfiAllowShort && cooledDown) {
            if (!signals[i]) { signals[i] = 'short'; lastEntryBar = i }
          }

          // Exit on opposite WT cross
          if (wtCrossDown && !inOverbought) {
            if (!signals[i]) signals[i] = 'close_long'
          }
          if (wtCrossUp && !inOversold) {
            if (!signals[i]) signals[i] = 'close_short'
          }
        }
      }

      // --- RSI ---
      if (strategyType.includes('rsi') && !strategyType.includes('stochrsi')) {
        const period = cfg.rsiPeriod || cfg.period || 14
        const overbought = cfg.overbought || 70
        const oversold = cfg.oversold || 30
        const rsiValues = rsi(closes, period)
        const oversoldLine = new Array(closes.length).fill(oversold) as number[]
        const overboughtLine = new Array(closes.length).fill(overbought) as number[]

        for (let i = 1; i < candles.length; i++) {
          if (rsiValues[i] === null) continue
          // RSI crosses below oversold -> long entry
          if (crossesAbove(rsiValues as (number | null)[], oversoldLine as (number | null)[], i)) {
            if (!signals[i]) signals[i] = 'long'
          }
          // RSI crosses above overbought -> close long / short entry
          if (crossesBelow(rsiValues as (number | null)[], overboughtLine as (number | null)[], i)) {
            if (!signals[i]) signals[i] = 'close_long'
          }
        }
      }

      // --- Stochastic RSI ---
      if (strategyType.includes('stochrsi') || strategyType.includes('stoch_rsi') || cfg.stochRsiLen) {
        const rsiLen = cfg.stochRsiLen || cfg.rsiPeriod || 14
        const stochLen = cfg.stochLen || 14
        const kSmooth = cfg.kSmooth || 3
        const dSmooth = cfg.dSmooth || 3
        const obLevel = cfg.stochOverbought || 80
        const osLevel = cfg.stochOversold || 20
        const { k, d } = stochRsi(closes, rsiLen, stochLen, kSmooth, dSmooth)

        for (let i = 1; i < candles.length; i++) {
          if (k[i] === null || d[i] === null) continue
          if (crossesAbove(k, d, i) && k[i]! < osLevel) {
            if (!signals[i]) signals[i] = 'long'
          }
          if (crossesBelow(k, d, i) && k[i]! > obLevel) {
            if (!signals[i]) signals[i] = 'short'
          }
        }
      }

      // --- EMA Crossover ---
      if (strategyType.includes('ema') || strategyType.includes('crossover') || strategyType.includes('ma_cross')) {
        const fast = cfg.fastPeriod || cfg.fastEma || 9
        const slow = cfg.slowPeriod || cfg.slowEma || 21
        const fastEma = ema(closes, fast)
        const slowEma = ema(closes, slow)

        for (let i = 1; i < candles.length; i++) {
          if (crossesAbove(fastEma, slowEma, i)) {
            if (!signals[i]) signals[i] = 'long'
          }
          if (crossesBelow(fastEma, slowEma, i)) {
            if (!signals[i]) signals[i] = 'close_long'
          }
        }
      }

      // --- MACD ---
      if (strategyType.includes('macd')) {
        const fastP = cfg.fastPeriod || 12
        const slowP = cfg.slowPeriod || 26
        const signalP = cfg.signalPeriod || 9
        const { macd: macdLine, signal: signalLine } = macd(closes, fastP, slowP, signalP)

        for (let i = 1; i < candles.length; i++) {
          if (crossesAbove(macdLine, signalLine, i)) {
            if (!signals[i]) signals[i] = 'long'
          }
          if (crossesBelow(macdLine, signalLine, i)) {
            if (!signals[i]) signals[i] = 'close_long'
          }
        }
      }

      // --- Bollinger Bands ---
      if (strategyType.includes('bollinger') || strategyType.includes('bb')) {
        const period = cfg.period || cfg.bbPeriod || 20
        const stdDev = cfg.stdDev || cfg.deviation || 2
        const { upper, lower } = bollingerBands(closes, period, stdDev)

        for (let i = 1; i < candles.length; i++) {
          if (lower[i] !== null && closes[i] <= lower[i]! && closes[i - 1] > lower[i - 1]!) {
            if (!signals[i]) signals[i] = 'long'
          }
          if (upper[i] !== null && closes[i] >= upper[i]! && closes[i - 1] < upper[i - 1]!) {
            if (!signals[i]) signals[i] = 'close_long'
          }
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

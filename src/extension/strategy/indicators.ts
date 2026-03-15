export function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += data[j]
    result.push(sum / period)
  }
  return result
}

export function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  const k = 2 / (period + 1)
  let prev: number | null = null
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    if (prev === null) {
      // First EMA = SMA
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += data[j]
      prev = sum / period
    } else {
      prev = data[i] * k + prev * (1 - k)
    }
    result.push(prev)
  }
  return result
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = []
  const gains: number[] = []
  const losses: number[] = []

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { result.push(null); continue }
    const change = closes[i] - closes[i - 1]
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)

    if (i < period) { result.push(null); continue }

    if (i === period) {
      const avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period
      const avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period
      if (avgLoss === 0) { result.push(100); continue }
      result.push(100 - 100 / (1 + avgGain / avgLoss))
    } else {
      // Use smoothed averages
      const avgGain = (gains.slice(-period).reduce((a, b) => a + b, 0)) / period
      const avgLoss = (losses.slice(-period).reduce((a, b) => a + b, 0)) / period
      if (avgLoss === 0) { result.push(100); continue }
      result.push(100 - 100 / (1 + avgGain / avgLoss))
    }
  }
  return result
}

export function macd(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): {
  macd: (number | null)[]
  signal: (number | null)[]
  histogram: (number | null)[]
} {
  const fastEma = ema(closes, fastPeriod)
  const slowEma = ema(closes, slowPeriod)
  const macdLine: (number | null)[] = fastEma.map((f, i) => {
    const s = slowEma[i]
    return f !== null && s !== null ? f - s : null
  })
  const macdValues = macdLine.filter((v): v is number => v !== null)
  const signalLine = ema(macdValues, signalPeriod)

  // Align signal back to original length
  const signal: (number | null)[] = new Array(macdLine.length).fill(null)
  let si = 0
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      signal[i] = signalLine[si] ?? null
      si++
    }
  }

  const histogram: (number | null)[] = macdLine.map((m, i) => {
    const s = signal[i]
    return m !== null && s !== null ? m - s : null
  })

  return { macd: macdLine, signal, histogram }
}

export function bollingerBands(closes: number[], period = 20, stdDev = 2): {
  upper: (number | null)[]
  middle: (number | null)[]
  lower: (number | null)[]
} {
  const middle = sma(closes, period)
  const upper: (number | null)[] = []
  const lower: (number | null)[] = []

  for (let i = 0; i < closes.length; i++) {
    const m = middle[i]
    if (m === null) { upper.push(null); lower.push(null); continue }
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) {
      variance += (closes[j] - m) ** 2
    }
    const sd = Math.sqrt(variance / period)
    upper.push(m + stdDev * sd)
    lower.push(m - stdDev * sd)
  }

  return { upper, middle, lower }
}

// Helper: detect crossover
export function crossesAbove(a: (number | null)[], b: (number | null)[], index: number): boolean {
  if (index < 1) return false
  const prev_a = a[index - 1], prev_b = b[index - 1], curr_a = a[index], curr_b = b[index]
  if (prev_a === null || prev_b === null || curr_a === null || curr_b === null) return false
  return prev_a <= prev_b && curr_a > curr_b
}

export function crossesBelow(a: (number | null)[], b: (number | null)[], index: number): boolean {
  if (index < 1) return false
  const prev_a = a[index - 1], prev_b = b[index - 1], curr_a = a[index], curr_b = b[index]
  if (prev_a === null || prev_b === null || curr_a === null || curr_b === null) return false
  return prev_a >= prev_b && curr_a < curr_b
}

/** WaveTrend Oscillator (VuManChu B / LazyBear) */
export function waveTrend(
  hlc3: number[],  // (high+low+close)/3
  channelLen: number,
  averageLen: number,
  maLen: number,
): { wt1: (number | null)[]; wt2: (number | null)[] } {
  // WT = EMA(EMA(hlc3, channelLen) diff, averageLen)
  const esa = ema(hlc3, channelLen)
  const d: number[] = hlc3.map((v, i) => esa[i] !== null ? Math.abs(v - esa[i]!) : 0)
  const de = ema(d, channelLen)

  const ci: (number | null)[] = hlc3.map((v, i) => {
    if (esa[i] === null || de[i] === null || de[i] === 0) return null
    return (v - esa[i]!) / (0.015 * de[i]!)
  })

  const ciValues = ci.map(v => v ?? 0)
  const wt1 = ema(ciValues, averageLen)
  const wt2 = sma(wt1.map(v => v ?? 0), maLen)

  return { wt1, wt2 }
}

/** Stochastic RSI */
export function stochRsi(
  closes: number[],
  rsiLen: number,
  stochLen: number,
  kSmooth: number,
  dSmooth: number,
): { k: (number | null)[]; d: (number | null)[] } {
  const rsiValues = rsi(closes, rsiLen)
  const rsiNums = rsiValues.map(v => v ?? 0)

  const stochK: (number | null)[] = []
  for (let i = 0; i < rsiNums.length; i++) {
    if (i < stochLen - 1 + rsiLen) { stochK.push(null); continue }
    const slice = rsiNums.slice(i - stochLen + 1, i + 1)
    const min = Math.min(...slice)
    const max = Math.max(...slice)
    stochK.push(max === min ? 50 : ((rsiNums[i] - min) / (max - min)) * 100)
  }

  const k = sma(stochK.map(v => v ?? 0), kSmooth)
  const d = sma(k.map(v => v ?? 0), dSmooth)

  return { k, d }
}

/** RSI-based MFI (Money Flow Index approximation using RSI of volume-weighted price) */
export function rsiMfi(closes: number[], volumes: number[], period: number): (number | null)[] {
  const mfi: number[] = closes.map((c, i) => {
    if (i === 0) return 0
    return (c - closes[i - 1]) * volumes[i]
  })
  return rsi(mfi.map(Math.abs), period)
}

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

/** Average True Range */
export function atr(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const tr: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { tr.push(highs[i] - lows[i]); continue }
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  }
  return sma(tr, period)
}

/** Volume Weighted Average Price (rolling) */
export function vwap(closes: number[], volumes: number[], period = 20): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sumPV = 0, sumV = 0
    for (let j = i - period + 1; j <= i; j++) { sumPV += closes[j] * volumes[j]; sumV += volumes[j] }
    result.push(sumV > 0 ? sumPV / sumV : null)
  }
  return result
}

/** Williams %R */
export function williamsR(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1))
    const ll = Math.min(...lows.slice(i - period + 1, i + 1))
    result.push(hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100)
  }
  return result
}

/** Commodity Channel Index */
export function cci(highs: number[], lows: number[], closes: number[], period = 20): (number | null)[] {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3)
  const tpSma = sma(tp, period)
  const result: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (tpSma[i] === null || i < period - 1) { result.push(null); continue }
    let md = 0
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - tpSma[i]!)
    md /= period
    result.push(md === 0 ? 0 : (tp[i] - tpSma[i]!) / (0.015 * md))
  }
  return result
}

/** Average Directional Index (simplified) */
export function adx(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [null]
  const plusDM: number[] = [0]
  const minusDM: number[] = [0]
  const tr: number[] = [highs[0] - lows[0]]

  for (let i = 1; i < closes.length; i++) {
    const upMove = highs[i] - highs[i-1]
    const downMove = lows[i-1] - lows[i]
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])))
  }

  const smoothTR = ema(tr, period)
  const smoothPDM = ema(plusDM, period)
  const smoothMDM = ema(minusDM, period)

  const dx: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (smoothTR[i] === null || smoothTR[i] === 0) { dx.push(0); continue }
    const pdi = (smoothPDM[i]! / smoothTR[i]!) * 100
    const mdi = (smoothMDM[i]! / smoothTR[i]!) * 100
    const sum = pdi + mdi
    dx.push(sum === 0 ? 0 : Math.abs(pdi - mdi) / sum * 100)
  }

  return ema(dx, period)
}

/** Rate of Change */
export function roc(data: number[], period = 12): (number | null)[] {
  return data.map((v, i) => i < period ? null : ((v - data[i - period]) / data[i - period]) * 100)
}

/** Momentum */
export function momentum(data: number[], period = 10): (number | null)[] {
  return data.map((v, i) => i < period ? null : v - data[i - period])
}

/** On-Balance Volume */
export function obv(closes: number[], volumes: number[]): number[] {
  const result = [0]
  for (let i = 1; i < closes.length; i++) {
    result.push(result[i-1] + (closes[i] > closes[i-1] ? volumes[i] : closes[i] < closes[i-1] ? -volumes[i] : 0))
  }
  return result
}

/** Money Flow Index */
export function mfi(highs: number[], lows: number[], closes: number[], volumes: number[], period = 14): (number | null)[] {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3)
  const result: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(null); continue }
    let posFlow = 0, negFlow = 0
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * volumes[j]
      if (tp[j] > tp[j-1]) posFlow += flow
      else negFlow += flow
    }
    result.push(negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow))
  }
  return result
}

/** Parabolic SAR (simplified) */
export function psar(highs: number[], lows: number[], af = 0.02, maxAf = 0.2): (number | null)[] {
  const result: (number | null)[] = [null]
  let trend = 1, sar = lows[0], ep = highs[0], accFactor = af
  for (let i = 1; i < highs.length; i++) {
    sar = sar + accFactor * (ep - sar)
    if (trend === 1) {
      if (lows[i] < sar) { trend = -1; sar = ep; ep = lows[i]; accFactor = af }
      else { if (highs[i] > ep) { ep = highs[i]; accFactor = Math.min(accFactor + af, maxAf) } }
    } else {
      if (highs[i] > sar) { trend = 1; sar = ep; ep = highs[i]; accFactor = af }
      else { if (lows[i] < ep) { ep = lows[i]; accFactor = Math.min(accFactor + af, maxAf) } }
    }
    result.push(sar)
  }
  return result
}

/** Ichimoku Cloud - Tenkan-sen */
export function ichimokuTenkan(highs: number[], lows: number[], period = 9): (number | null)[] {
  return highs.map((_, i) => {
    if (i < period - 1) return null
    const hh = Math.max(...highs.slice(i - period + 1, i + 1))
    const ll = Math.min(...lows.slice(i - period + 1, i + 1))
    return (hh + ll) / 2
  })
}

/** Ichimoku Cloud - Kijun-sen */
export function ichimokuKijun(highs: number[], lows: number[], period = 26): (number | null)[] {
  return ichimokuTenkan(highs, lows, period)
}

/** Donchian Channel Upper */
export function donchianUpper(highs: number[], period = 20): (number | null)[] {
  return highs.map((_, i) => i < period - 1 ? null : Math.max(...highs.slice(i - period + 1, i + 1)))
}

/** Donchian Channel Lower */
export function donchianLower(lows: number[], period = 20): (number | null)[] {
  return lows.map((_, i) => i < period - 1 ? null : Math.min(...lows.slice(i - period + 1, i + 1)))
}

/** Keltner Channel Upper */
export function keltnerUpper(closes: number[], highs: number[], lows: number[], emaPeriod = 20, atrPeriod = 10, multiplier = 2): (number | null)[] {
  const e = ema(closes, emaPeriod)
  const a = atr(highs, lows, closes, atrPeriod)
  return e.map((v, i) => v !== null && a[i] !== null ? v + multiplier * a[i]! : null)
}

/** Keltner Channel Lower */
export function keltnerLower(closes: number[], highs: number[], lows: number[], emaPeriod = 20, atrPeriod = 10, multiplier = 2): (number | null)[] {
  const e = ema(closes, emaPeriod)
  const a = atr(highs, lows, closes, atrPeriod)
  return e.map((v, i) => v !== null && a[i] !== null ? v - multiplier * a[i]! : null)
}

/** Standard Deviation */
export function stdDev(data: number[], period = 20): (number | null)[] {
  const avg = sma(data, period)
  return data.map((_, i) => {
    if (avg[i] === null) return null
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) variance += (data[j] - avg[i]!) ** 2
    return Math.sqrt(variance / period)
  })
}

/** Chaikin Money Flow */
export function cmf(highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): (number | null)[] {
  const mfv = closes.map((c, i) => {
    const range = highs[i] - lows[i]
    return range === 0 ? 0 : ((c - lows[i]) - (highs[i] - c)) / range * volumes[i]
  })
  const result: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sumMFV = 0, sumVol = 0
    for (let j = i - period + 1; j <= i; j++) { sumMFV += mfv[j]; sumVol += volumes[j] }
    result.push(sumVol === 0 ? 0 : sumMFV / sumVol)
  }
  return result
}

/** Highest High over N bars */
export function highest(data: number[], period = 14): (number | null)[] {
  return data.map((_, i) => i < period - 1 ? null : Math.max(...data.slice(i - period + 1, i + 1)))
}

/** Lowest Low over N bars */
export function lowest(data: number[], period = 14): (number | null)[] {
  return data.map((_, i) => i < period - 1 ? null : Math.min(...data.slice(i - period + 1, i + 1)))
}

/** DEMA - Double Exponential Moving Average */
export function dema(data: number[], period: number): (number | null)[] {
  const e1 = ema(data, period)
  const e2 = ema(e1.map(v => v ?? 0), period)
  return e1.map((v, i) => v !== null && e2[i] !== null ? 2 * v - e2[i]! : null)
}

/** TEMA - Triple Exponential Moving Average */
export function tema(data: number[], period: number): (number | null)[] {
  const e1 = ema(data, period)
  const e2 = ema(e1.map(v => v ?? 0), period)
  const e3 = ema(e2.map(v => v ?? 0), period)
  return e1.map((v, i) => v !== null && e2[i] !== null && e3[i] !== null ? 3*v - 3*e2[i]! + e3[i]! : null)
}

/** WMA - Weighted Moving Average */
export function wma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  const denom = (period * (period + 1)) / 2
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sum = 0
    for (let j = 0; j < period; j++) sum += data[i - period + 1 + j] * (j + 1)
    result.push(sum / denom)
  }
  return result
}

/** HMA - Hull Moving Average */
export function hma(data: number[], period: number): (number | null)[] {
  const half = Math.floor(period / 2)
  const wmaHalf = wma(data, half)
  const wmaFull = wma(data, period)
  const diff = wmaHalf.map((v, i) => v !== null && wmaFull[i] !== null ? 2 * v - wmaFull[i]! : 0)
  return wma(diff, Math.floor(Math.sqrt(period)))
}

/** TRIX - Triple Smoothed EMA Rate of Change */
export function trix(data: number[], period = 15): (number | null)[] {
  const e1 = ema(data, period)
  const e2 = ema(e1.map(v => v ?? 0), period)
  const e3 = ema(e2.map(v => v ?? 0), period)
  return e3.map((v, i) => i === 0 || v === null || e3[i-1] === null || e3[i-1] === 0 ? null : ((v - e3[i-1]!) / e3[i-1]!) * 10000)
}

/** Choppiness Index */
export function chop(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const atrVals = atr(highs, lows, closes, 1)
  return highs.map((_, i) => {
    if (i < period) return null
    let sumATR = 0
    for (let j = i - period + 1; j <= i; j++) sumATR += atrVals[j] ?? 0
    const hh = Math.max(...highs.slice(i - period + 1, i + 1))
    const ll = Math.min(...lows.slice(i - period + 1, i + 1))
    const range = hh - ll
    return range === 0 ? 50 : (Math.log10(sumATR / range) / Math.log10(period)) * 100
  })
}

/** Aroon Up */
export function aroonUp(highs: number[], period = 25): (number | null)[] {
  return highs.map((_, i) => {
    if (i < period) return null
    const slice = highs.slice(i - period, i + 1)
    const highIdx = slice.indexOf(Math.max(...slice))
    return (highIdx / period) * 100
  })
}

/** Aroon Down */
export function aroonDown(lows: number[], period = 25): (number | null)[] {
  return lows.map((_, i) => {
    if (i < period) return null
    const slice = lows.slice(i - period, i + 1)
    const lowIdx = slice.indexOf(Math.min(...slice))
    return (lowIdx / period) * 100
  })
}

/** Ultimate Oscillator */
export function ultimateOsc(highs: number[], lows: number[], closes: number[], p1 = 7, p2 = 14, p3 = 28): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < p3) { result.push(null); continue }
    const bp = (j: number) => closes[j] - Math.min(lows[j], closes[j-1])
    const tr = (j: number) => Math.max(highs[j], closes[j-1]) - Math.min(lows[j], closes[j-1])
    let s1b=0,s1t=0,s2b=0,s2t=0,s3b=0,s3t=0
    for(let j=i-p1+1;j<=i;j++){s1b+=bp(j);s1t+=tr(j)}
    for(let j=i-p2+1;j<=i;j++){s2b+=bp(j);s2t+=tr(j)}
    for(let j=i-p3+1;j<=i;j++){s3b+=bp(j);s3t+=tr(j)}
    const a1=s1t?s1b/s1t:0, a2=s2t?s2b/s2t:0, a3=s3t?s3b/s3t:0
    result.push(100 * (4*a1 + 2*a2 + a3) / 7)
  }
  return result
}

/** Percentage Price Oscillator */
export function ppo(data: number[], fastPeriod = 12, slowPeriod = 26): (number | null)[] {
  const fast = ema(data, fastPeriod)
  const slow = ema(data, slowPeriod)
  return fast.map((f, i) => f !== null && slow[i] !== null && slow[i] !== 0 ? ((f - slow[i]!) / slow[i]!) * 100 : null)
}

/** Detrended Price Oscillator */
export function dpo(closes: number[], period = 20): (number | null)[] {
  const shift = Math.floor(period / 2) + 1
  const avg = sma(closes, period)
  return closes.map((c, i) => i >= shift && avg[i - shift] !== null ? c - avg[i - shift]! : null)
}

/** Mass Index */
export function massIndex(highs: number[], lows: number[], period = 9, sumPeriod = 25): (number | null)[] {
  const range = highs.map((h, i) => h - lows[i])
  const e1 = ema(range, period)
  const e2 = ema(e1.map(v => v ?? 0), period)
  const ratio = e1.map((v, i) => v !== null && e2[i] !== null && e2[i] !== 0 ? v / e2[i]! : 1)
  const result: (number | null)[] = []
  for (let i = 0; i < ratio.length; i++) {
    if (i < sumPeriod - 1) { result.push(null); continue }
    let sum = 0
    for (let j = i - sumPeriod + 1; j <= i; j++) sum += ratio[j]
    result.push(sum)
  }
  return result
}

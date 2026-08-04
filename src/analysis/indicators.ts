import type { Candle } from '../data/types'

export const closes = (cs: Candle[]) => cs.map((c) => c.close)
export const volumes = (cs: Candle[]) => cs.map((c) => c.volume)

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function rsi(cl: number[], period = 14): number[] {
  const out = new Array<number>(cl.length).fill(NaN)
  if (cl.length <= period) return out
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = cl[i] - cl[i - 1]
    if (d >= 0) avgGain += d
    else avgLoss -= d
  }
  avgGain /= period
  avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1]
    const gain = d > 0 ? d : 0
    const loss = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

export function macd(cl: number[]) {
  const fast = ema(cl, 12)
  const slow = ema(cl, 26)
  const line = cl.map((_, i) =>
    Number.isNaN(fast[i]) || Number.isNaN(slow[i]) ? NaN : fast[i] - slow[i],
  )
  const firstValid = line.findIndex((v) => !Number.isNaN(v))
  const signal = new Array<number>(cl.length).fill(NaN)
  if (firstValid >= 0) {
    const sig = ema(line.slice(firstValid), 9)
    for (let i = 0; i < sig.length; i++) signal[firstValid + i] = sig[i]
  }
  const hist = line.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(signal[i]) ? NaN : v - signal[i],
  )
  return { macd: line, signal, hist }
}

export function bollinger(cl: number[], period = 20, k = 2) {
  const mid = sma(cl, period)
  const upper = new Array<number>(cl.length).fill(NaN)
  const lower = new Array<number>(cl.length).fill(NaN)
  for (let i = period - 1; i < cl.length; i++) {
    const win = cl.slice(i - period + 1, i + 1)
    const m = mid[i]
    const sd = Math.sqrt(win.reduce((a, v) => a + (v - m) ** 2, 0) / period)
    upper[i] = m + k * sd
    lower[i] = m - k * sd
  }
  return { mid, upper, lower }
}

export function atr(cs: Candle[], period = 14): number[] {
  const tr = cs.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1].close), Math.abs(c.low - cs[i - 1].close)),
  )
  const out = new Array<number>(cs.length).fill(NaN)
  if (cs.length < period) return out
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < cs.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period
    out[i] = prev
  }
  return out
}

export function obv(cs: Candle[]): number[] {
  const out = new Array<number>(cs.length).fill(0)
  for (let i = 1; i < cs.length; i++) {
    const d = cs[i].close - cs[i - 1].close
    out[i] = out[i - 1] + (d > 0 ? cs[i].volume : d < 0 ? -cs[i].volume : 0)
  }
  return out
}

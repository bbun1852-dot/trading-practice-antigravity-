import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'

export type Pivot = {
  /** 신호 확정 시점 = pivotBar + n */
  barIndex: number
  /** 실제 봉우리/골짜기 봉 */
  pivotBar: number
  price: number
  kind: 'high' | 'low'
}

/**
 * fractal 방식 스윙 감지. 좌우 n봉보다 극단이면 피벗.
 * 오른쪽 n봉이 있어야 확정되므로 barIndex는 pivotBar+n 이다.
 */
export function findPivots(cs: Candle[], n = 2): Pivot[] {
  const out: Pivot[] = []
  for (let i = n; i < cs.length - n; i++) {
    let isHigh = true
    let isLow = true
    for (let j = 1; j <= n; j++) {
      if (cs[i].high <= cs[i - j].high || cs[i].high <= cs[i + j].high) isHigh = false
      if (cs[i].low >= cs[i - j].low || cs[i].low >= cs[i + j].low) isLow = false
    }
    if (isHigh) out.push({ barIndex: i + n, pivotBar: i, price: cs[i].high, kind: 'high' })
    if (isLow) out.push({ barIndex: i + n, pivotBar: i, price: cs[i].low, kind: 'low' })
  }
  return out.sort((a, b) => a.barIndex - b.barIndex || a.kind.localeCompare(b.kind))
}

/**
 * 마지막 확정 시점 기준으로 추세를 판정한다.
 * 최근 스윙하이 2개와 스윙로우 2개를 비교: HH+HL=상승, LH+LL=하락, 그 외 횡보.
 */
export function detectTrend(cs: Candle[]): Signal[] {
  const pivots = findPivots(cs, 2)
  if (pivots.length === 0) return []
  const last = pivots[pivots.length - 1].barIndex

  const highs = pivots.filter((p) => p.kind === 'high').slice(-2)
  const lows = pivots.filter((p) => p.kind === 'low').slice(-2)
  if (highs.length < 2 || lows.length < 2) return []

  const hh = highs[1].price > highs[0].price
  const hl = lows[1].price > lows[0].price
  const lh = highs[1].price < highs[0].price
  const ll = lows[1].price < lows[0].price

  const base = { tier: 3 as const, kind: 'structure' as const, confidence: 'A' as const, barIndex: last }

  if (hh && hl) {
    return [{ ...base, id: 'trend_up_structure', side: 'bullish', strength: 2,
      evidence: `고점 ${highs[0].price.toFixed(2)}→${highs[1].price.toFixed(2)} 상승, 저점 ${lows[0].price.toFixed(2)}→${lows[1].price.toFixed(2)} 상승 (HH/HL)` }]
  }
  if (lh && ll) {
    return [{ ...base, id: 'trend_down_structure', side: 'bearish', strength: 2,
      evidence: `고점 ${highs[0].price.toFixed(2)}→${highs[1].price.toFixed(2)} 하락, 저점 ${lows[0].price.toFixed(2)}→${lows[1].price.toFixed(2)} 하락 (LH/LL)` }]
  }
  return [{ ...base, id: 'trend_range', side: 'neutral', strength: 1,
    evidence: '고점·저점이 한 방향으로 정렬되지 않음 (횡보)' }]
}

/** 피벗 가격을 tolerance 내로 묶어 수평 지지·저항 레벨을 만든다 */
export function srLevels(cs: Candle[], tolerancePct = 0.005) {
  const pivots = findPivots(cs, 2)
  const clusters: { price: number; touches: number; lastBar: number }[] = []
  for (const p of pivots) {
    const hit = clusters.find((c) => Math.abs(c.price - p.price) / c.price <= tolerancePct)
    if (hit) {
      hit.price = (hit.price * hit.touches + p.price) / (hit.touches + 1)
      hit.touches += 1
      hit.lastBar = Math.max(hit.lastBar, p.barIndex)
    } else {
      clusters.push({ price: p.price, touches: 1, lastBar: p.barIndex })
    }
  }
  return clusters.filter((c) => c.touches >= 2).sort((a, b) => b.touches - a.touches)
}

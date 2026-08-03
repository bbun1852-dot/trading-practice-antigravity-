import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { atr } from './indicators'
import { findPivots, type Pivot } from './structure'

/** 상승/하락 FVG 중 decisionIndex 시점에 아직 메워지지 않은 것만 낸다 */
export function detectFVG(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  for (let i = 2; i < cs.length; i++) {
    const bullGap = cs[i].low > cs[i - 2].high
    const bearGap = cs[i].high < cs[i - 2].low
    if (!bullGap && !bearGap) continue

    const lo = bullGap ? cs[i - 2].high : cs[i].high
    const hi = bullGap ? cs[i].low : cs[i - 2].low

    let filled = false
    for (let j = i + 1; j < cs.length; j++) {
      if (cs[j].low <= hi && cs[j].high >= lo) { filled = true; break }
    }
    if (filled) continue

    out.push({
      id: bullGap ? 'fvg_bull' : 'fvg_bear',
      tier: 2, kind: 'smc', side: bullGap ? 'bullish' : 'bearish',
      barIndex: i, confidence: 'A', strength: 2,
      evidence: `${bullGap ? '상승' : '하락'} FVG ${lo.toFixed(2)}~${hi.toFixed(2)} 미충족`,
      refs: { priceLow: lo, priceHigh: hi, fromBar: i - 2, toBar: i },
    })
  }
  return out
}

/** 강한 임펄스 직전의 반대 캔들을 오더블록으로 본다 */
export function detectOrderBlocks(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  const a = atr(cs, 14)
  const LOOKAHEAD = 3
  const MIN_IMPULSE = 1.5

  for (let i = 1; i < cs.length - 1; i++) {
    const range = a[i]
    if (Number.isNaN(range) || range <= 0) continue

    const isDown = cs[i].close < cs[i].open
    const isUp = cs[i].close > cs[i].open

    for (let j = i + 1; j <= Math.min(i + LOOKAHEAD, cs.length - 1); j++) {
      if (isDown && cs[j].close > cs[i].high && cs[j].close - cs[i].low >= MIN_IMPULSE * range) {
        out.push({
          id: 'ob_bull_support', tier: 1, kind: 'smc', side: 'bullish',
          barIndex: j, confidence: 'A', strength: 3,
          evidence: `${j - i}봉 뒤 ${((cs[j].close - cs[i].low) / range).toFixed(1)}ATR 상승 임펄스 직전 음봉 (${cs[i].low.toFixed(2)}~${cs[i].high.toFixed(2)})`,
          refs: { priceLow: cs[i].low, priceHigh: cs[i].high, pivotBar: i, fromBar: i, toBar: j },
        })
        break
      }
      if (isUp && cs[j].close < cs[i].low && cs[i].high - cs[j].close >= MIN_IMPULSE * range) {
        out.push({
          id: 'ob_bear_resistance', tier: 1, kind: 'smc', side: 'bearish',
          barIndex: j, confidence: 'A', strength: 3,
          evidence: `${j - i}봉 뒤 ${((cs[i].high - cs[j].close) / range).toFixed(1)}ATR 하락 임펄스 직전 양봉 (${cs[i].low.toFixed(2)}~${cs[i].high.toFixed(2)})`,
          refs: { priceLow: cs[i].low, priceHigh: cs[i].high, pivotBar: i, fromBar: i, toBar: j },
        })
        break
      }
    }
  }
  return out
}

/** i 시점에 이미 확정된 피벗 중 가장 최근 것 */
function lastConfirmedPivot(pivots: Pivot[], i: number, kind: 'high' | 'low'): Pivot | undefined {
  let found: Pivot | undefined
  for (const p of pivots) {
    if (p.kind !== kind) continue
    if (p.barIndex > i) break
    found = p
  }
  return found
}

export function detectLiquiditySweep(cs: Candle[]): Signal[] {
  const pivots = findPivots(cs, 2)
  const out: Signal[] = []

  for (let i = 0; i < cs.length; i++) {
    const lo = lastConfirmedPivot(pivots, i, 'low')
    if (lo && lo.pivotBar < i && cs[i].low < lo.price && cs[i].close > lo.price) {
      out.push({
        id: 'liq_sweep_low', tier: 1, kind: 'smc', side: 'bullish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `스윙로우 ${lo.price.toFixed(2)} 를 저가 ${cs[i].low.toFixed(2)} 로 이탈 후 종가 ${cs[i].close.toFixed(2)} 로 복귀 (롱 손절 사냥)`,
        refs: { price: lo.price, pivotBar: lo.pivotBar, toBar: i },
      })
    }
    const hi = lastConfirmedPivot(pivots, i, 'high')
    if (hi && hi.pivotBar < i && cs[i].high > hi.price && cs[i].close < hi.price) {
      out.push({
        id: 'liq_sweep_high', tier: 1, kind: 'smc', side: 'bearish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `스윙하이 ${hi.price.toFixed(2)} 를 고가 ${cs[i].high.toFixed(2)} 로 이탈 후 종가 ${cs[i].close.toFixed(2)} 로 복귀 (숏 손절 사냥)`,
        refs: { price: hi.price, pivotBar: hi.pivotBar, toBar: i },
      })
    }
  }
  return out
}

export function detectMSB(cs: Candle[]): Signal[] {
  const pivots = findPivots(cs, 2)
  const out: Signal[] = []
  let lastBullBreak = -1
  let lastBearBreak = -1

  for (let i = 0; i < cs.length; i++) {
    const hi = lastConfirmedPivot(pivots, i, 'high')
    if (hi && hi.pivotBar < i && cs[i].close > hi.price && hi.pivotBar > lastBullBreak) {
      lastBullBreak = hi.pivotBar
      out.push({
        id: 'msb_bull', tier: 1, kind: 'structure', side: 'bullish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `종가 ${cs[i].close.toFixed(2)} 가 직전 스윙하이 ${hi.price.toFixed(2)} 상향 돌파 (구조 상승)`,
        refs: { price: hi.price, pivotBar: hi.pivotBar, toBar: i },
      })
    }
    const lo = lastConfirmedPivot(pivots, i, 'low')
    if (lo && lo.pivotBar < i && cs[i].close < lo.price && lo.pivotBar > lastBearBreak) {
      lastBearBreak = lo.pivotBar
      out.push({
        id: 'msb_bear', tier: 1, kind: 'structure', side: 'bearish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `종가 ${cs[i].close.toFixed(2)} 가 직전 스윙로우 ${lo.price.toFixed(2)} 하향 붕괴 (구조 하락)`,
        refs: { price: lo.price, pivotBar: lo.pivotBar, toBar: i },
      })
    }
  }
  return out
}

import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { atr } from './indicators'

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

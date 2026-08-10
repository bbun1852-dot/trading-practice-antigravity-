import type { Candle } from '../data/types'
import type { Signal, SignalSide } from './signalTypes'
import { findPivots } from './structure'
import { rsi, macd, obv, closes } from './indicators'
import { fmtPrice } from '../format'

type DivSpec = {
  id: string
  kind: 'momentum' | 'volume'
  series: number[]
  seriesName: string
  /**
   * 계열마다 눈금이 다르다. RSI 는 0~100 의 무차원 수라 소수 한 자리로 충분하고,
   * OBV 는 거래량 누적이라 값이 크다. **MACD 히스토그램만 EMA 차이라 가격 단위다** —
   * 고정 자릿수로 찍으면 저가 자산에서 "히스토그램 0.0→0.0" 이 되어, 다이버전스가
   * 지표의 변화를 요구하는 신호인데 그 변화가 화면에서 사라진다.
   */
  fmtValue: (v: number) => string
  pivotKind: 'high' | 'low'
  /** 가격 방향과 지표 방향 조합 */
  priceUp: boolean
  indicatorUp: boolean
  side: SignalSide
}

export function detectDivergence(cs: Candle[]): Signal[] {
  if (cs.length < 30) return []
  const cl = closes(cs)
  const r = rsi(cl, 14)
  const m = macd(cl).hist
  const o = obv(cs)
  const pivots = findPivots(cs, 2)

  const fmtRsi = (v: number) => v.toFixed(1)
  const fmtObv = (v: number) => v.toFixed(1)

  const specs: DivSpec[] = [
    { id: 'rsi_bull_div',   kind: 'momentum', series: r, seriesName: 'RSI',  pivotKind: 'low',  priceUp: false, indicatorUp: true,  side: 'bullish', fmtValue: fmtRsi },
    { id: 'rsi_bear_div',   kind: 'momentum', series: r, seriesName: 'RSI',  pivotKind: 'high', priceUp: true,  indicatorUp: false, side: 'bearish', fmtValue: fmtRsi },
    { id: 'rsi_hidden_div', kind: 'momentum', series: r, seriesName: 'RSI',  pivotKind: 'low',  priceUp: true,  indicatorUp: false, side: 'bullish', fmtValue: fmtRsi },
    { id: 'macd_divergence', kind: 'momentum', series: m, seriesName: 'MACD 히스토그램', pivotKind: 'low', priceUp: false, indicatorUp: true, side: 'bullish', fmtValue: fmtPrice },
    { id: 'obv_divergence',  kind: 'volume',   series: o, seriesName: 'OBV', pivotKind: 'low',  priceUp: false, indicatorUp: true,  side: 'bullish', fmtValue: fmtObv },
    { id: 'macd_divergence', kind: 'momentum', series: m, seriesName: 'MACD 히스토그램',
      pivotKind: 'high', priceUp: true, indicatorUp: false, side: 'bearish', fmtValue: fmtPrice },
    { id: 'obv_divergence',  kind: 'volume',   series: o, seriesName: 'OBV',
      pivotKind: 'high', priceUp: true, indicatorUp: false, side: 'bearish', fmtValue: fmtObv },
  ]

  const out: Signal[] = []
  for (const spec of specs) {
    const ps = pivots.filter((p) => p.kind === spec.pivotKind)
    for (let k = 1; k < ps.length; k++) {
      const p0 = ps[k - 1]
      const p1 = ps[k]
      if (p1.pivotBar - p0.pivotBar < 5 || p1.pivotBar - p0.pivotBar > 60) continue

      const v0 = spec.series[p0.pivotBar]
      const v1 = spec.series[p1.pivotBar]
      if (Number.isNaN(v0) || Number.isNaN(v1)) continue

      const priceMoved = spec.priceUp ? p1.price > p0.price : p1.price < p0.price
      const indMoved = spec.indicatorUp ? v1 > v0 : v1 < v0
      if (!priceMoved || !indMoved) continue

      out.push({
        id: spec.id, tier: 4, kind: spec.kind, side: spec.side,
        barIndex: p1.barIndex, confidence: 'A', strength: 2,
        evidence: `가격 ${spec.pivotKind === 'low' ? '저점' : '고점'} ${fmtPrice(p0.price)}→${fmtPrice(p1.price)}, ${spec.seriesName} ${spec.fmtValue(v0)}→${spec.fmtValue(v1)}`,
        refs: { fromBar: p0.pivotBar, toBar: p1.pivotBar, priceLow: Math.min(p0.price, p1.price), priceHigh: Math.max(p0.price, p1.price) },
      })
    }
  }
  return out
}

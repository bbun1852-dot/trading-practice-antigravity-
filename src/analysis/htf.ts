import type { Candle, Timeframe } from '../data/types'
import { DURATION } from '../data/types'
import type { Signal } from './signalTypes'
import { findPivots } from './structure'
import { fmtPrice } from '../format'

/** 상위 봉 피벗 확정에 필요한 좌우 봉수 */
const HTF_PIVOT_N = 2
/** POI 로 볼 근접 허용오차 (종가 대비 비율) */
const POI_TOL = 0.002

function findLtfIndex(time: number, cs: Candle[]): number {
  for (let i = 0; i < cs.length; i++) {
    if (cs[i].time >= time) return i
  }
  return 0
}

export function detectHTF(
  cs: Candle[],
  tf: Timeframe = '1h',
  htfCs?: Candle[],
  htfTf?: Timeframe
): Signal[] {
  if (!htfCs || !htfTf) return []
  if (cs.length === 0) return []

  const out: Signal[] = []
  const htfPivots = findPivots(htfCs, HTF_PIVOT_N)

  let lastTrend: 'up' | 'down' | undefined
  const fired = new Set<string>()

  let htfIndex = -1

  for (let i = 0; i < cs.length; i++) {
    const ltfTime = cs[i].time + DURATION[tf]

    // Advance htfIndex to the latest CLOSED HTF candle.
    // An HTF candle is closed when its time + HTF_DURATION <= LTF_TIME + LTF_DURATION.
    while (
      htfIndex + 1 < htfCs.length &&
      htfCs[htfIndex + 1].time + DURATION[htfTf] <= ltfTime
    ) {
      htfIndex++
    }

    if (htfIndex < 0) continue

    const hc = htfCs[htfIndex]
    const ltfIndex = i

    // 확정된 상위 피벗만 쓴다 (barIndex = pivotBar + HTF_PIVOT_N).
    // findPivots가 뱉는 p.barIndex는 해당 피벗이 확정된 "htfCs 상의 인덱스"이다.
    const avail = htfPivots.filter((p) => p.barIndex <= htfIndex)
    const hLows = avail.filter((p) => p.kind === 'low')
    const hHighs = avail.filter((p) => p.kind === 'high')
    if (hLows.length < 2 || hHighs.length < 2) continue

    const l1 = hLows[hLows.length - 2]
    const l2 = hLows[hLows.length - 1]
    const h1 = hHighs[hHighs.length - 2]
    const h2 = hHighs[hHighs.length - 1]

    const isUpTrend = l2.price > l1.price && h2.price > h1.price
    const isDnTrend = l2.price < l1.price && h2.price < h1.price

    // ── 1) HTF 추세 정렬 — 정렬이 바뀐 순간에만 ──────────────────────────
    if (isUpTrend && lastTrend !== 'up') {
      lastTrend = 'up'
      out.push({
        id: 'htf_trend', tier: 3, kind: 'structure', side: 'bullish',
        barIndex: ltfIndex, confidence: 'A', strength: 2,
        evidence: `HTF 추세가 상승으로 정렬 (저점 ${fmtPrice(l1.price)} → ${fmtPrice(l2.price)})`,
        refs: { 
          price: l2.price, 
          fromBar: findLtfIndex(htfCs[l1.pivotBar].time, cs), 
          toBar: ltfIndex, 
          pivotBar: findLtfIndex(htfCs[l2.pivotBar].time, cs) 
        },
      })
    } else if (isDnTrend && lastTrend !== 'down') {
      lastTrend = 'down'
      out.push({
        id: 'htf_trend', tier: 3, kind: 'structure', side: 'bearish',
        barIndex: ltfIndex, confidence: 'A', strength: 2,
        evidence: `HTF 추세가 하락으로 정렬 (고점 ${fmtPrice(h1.price)} → ${fmtPrice(h2.price)})`,
        refs: { 
          price: h2.price, 
          fromBar: findLtfIndex(htfCs[h1.pivotBar].time, cs), 
          toBar: ltfIndex, 
          pivotBar: findLtfIndex(htfCs[h2.pivotBar].time, cs) 
        },
      })
    }

    // ── 2) HTF 구조 붕괴 — 자리 하나당 한 번 ─────────────────────────────
    if (isUpTrend && hc.close < l2.price && !fired.has(`bos|dn|${l2.pivotBar}`)) {
      fired.add(`bos|dn|${l2.pivotBar}`)
      out.push({
        id: 'htf_bos', tier: 3, kind: 'structure', side: 'bearish',
        barIndex: ltfIndex, confidence: 'A', strength: 3,
        evidence: `HTF 직전 저점 ${fmtPrice(l2.price)} 하방 이탈 (BOS)`,
        refs: { 
          price: l2.price, 
          fromBar: findLtfIndex(htfCs[l2.pivotBar].time, cs), 
          toBar: ltfIndex, 
          pivotBar: findLtfIndex(htfCs[l2.pivotBar].time, cs) 
        },
      })
    } else if (isDnTrend && hc.close > h2.price && !fired.has(`bos|up|${h2.pivotBar}`)) {
      fired.add(`bos|up|${h2.pivotBar}`)
      out.push({
        id: 'htf_bos', tier: 3, kind: 'structure', side: 'bullish',
        barIndex: ltfIndex, confidence: 'A', strength: 3,
        evidence: `HTF 직전 고점 ${fmtPrice(h2.price)} 상방 돌파 (BOS)`,
        refs: { 
          price: h2.price, 
          fromBar: findLtfIndex(htfCs[h2.pivotBar].time, cs), 
          toBar: ltfIndex, 
          pivotBar: findLtfIndex(htfCs[h2.pivotBar].time, cs) 
        },
      })
    }

    // ── 3) HTF 주요 구간(POI) — 첫 터치에서만 ────────────────────────────
    if (Math.abs(hc.low - l2.price) / hc.close < POI_TOL && !fired.has(`poi|lo|${l2.pivotBar}`)) {
      fired.add(`poi|lo|${l2.pivotBar}`)
      out.push({
        id: 'htf_poi', tier: 3, kind: 'smc', side: 'bullish',
        barIndex: ltfIndex, confidence: 'A', strength: 2,
        evidence: `HTF 주요 저점(POI) ${fmtPrice(l2.price)} 첫 도달`,
        refs: { 
          price: l2.price, 
          fromBar: findLtfIndex(htfCs[l2.pivotBar].time, cs), 
          toBar: ltfIndex, 
          pivotBar: findLtfIndex(htfCs[l2.pivotBar].time, cs) 
        },
      })
    } else if (Math.abs(hc.high - h2.price) / hc.close < POI_TOL && !fired.has(`poi|hi|${h2.pivotBar}`)) {
      fired.add(`poi|hi|${h2.pivotBar}`)
      out.push({
        id: 'htf_poi', tier: 3, kind: 'smc', side: 'bearish',
        barIndex: ltfIndex, confidence: 'A', strength: 2,
        evidence: `HTF 주요 고점(POI) ${fmtPrice(h2.price)} 첫 도달`,
        refs: { 
          price: h2.price, 
          fromBar: findLtfIndex(htfCs[h2.pivotBar].time, cs), 
          toBar: ltfIndex, 
          pivotBar: findLtfIndex(htfCs[h2.pivotBar].time, cs) 
        },
      })
    }
  }

  return out.sort((x, y) => x.barIndex - y.barIndex || x.id.localeCompare(y.id))
}

import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { findPivots } from './structure'
import { fmtPrice } from '../format'

/**
 * 하위 타임프레임(LTF) 캔들을 묶어 상위 타임프레임(HTF) 캔들로 변환
 */
function aggregateCandles(cs: Candle[], factor: number): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < cs.length; i += factor) {
    const chunk = cs.slice(i, i + factor)
    const open = chunk[0].open
    const close = chunk[chunk.length - 1].close
    const high = Math.max(...chunk.map(c => c.high))
    const low = Math.min(...chunk.map(c => c.low))
    const volume = chunk.reduce((sum, c) => sum + c.volume, 0)
    
    out.push({
      time: chunk[0].time,
      open,
      high,
      low,
      close,
      volume
    })
  }
  return out
}

export function detectHTF(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  if (cs.length < 100) return out // HTF 조회를 위해 충분한 데이터 필요

  // 1시간봉 기준이라면 4시간봉(x4) 정도로 묶기
  const FACTOR = 4
  const htfCandles = aggregateCandles(cs, FACTOR)
  const htfPivots = findPivots(htfCandles, 2)
  const fired = new Set<string>()

  // 마지막 HTF 캔들을 기준으로 현재 상태를 판별
  // HTF 캔들 인덱스를 LTF 인덱스로 매핑할 수 있도록 주의해야 함

  for (let i = 20; i < htfCandles.length; i++) {
    const hc = htfCandles[i]
    // 현재 HTF 캔들의 끝에 해당하는 LTF 캔들 인덱스
    const ltfIndex = Math.min((i + 1) * FACTOR - 1, cs.length - 1)
    
    const recentPivots = htfPivots.filter(p => p.barIndex < i)
    if (recentPivots.length < 4) continue

    const hLows = recentPivots.filter(p => p.kind === 'low')
    const hHighs = recentPivots.filter(p => p.kind === 'high')

    // HTF 추세 판별 (고점 갱신, 저점 갱신)
    if (hLows.length >= 2 && hHighs.length >= 2) {
      const l1 = hLows[hLows.length - 2]
      const l2 = hLows[hLows.length - 1]
      const h1 = hHighs[hHighs.length - 2]
      const h2 = hHighs[hHighs.length - 1]

      const isUpTrend = l2.price > l1.price && h2.price > h1.price
      const isDnTrend = l2.price < l1.price && h2.price < h1.price

      // 1) HTF 추세 정렬 (Trend)
      if (isUpTrend && hc.close > hc.open && !fired.has(`trend|up|${ltfIndex}`)) {
        fired.add(`trend|up|${ltfIndex}`)
        out.push({
          id: 'htf_trend', tier: 3, kind: 'structure', side: 'bullish',
          barIndex: ltfIndex, confidence: 'B', strength: 2,
          evidence: `HTF 상승 추세 유지 중`,
          refs: { price: hc.close, fromBar: l2.barIndex * FACTOR, toBar: ltfIndex }
        })
      } else if (isDnTrend && hc.close < hc.open && !fired.has(`trend|dn|${ltfIndex}`)) {
        fired.add(`trend|dn|${ltfIndex}`)
        out.push({
          id: 'htf_trend', tier: 3, kind: 'structure', side: 'bearish',
          barIndex: ltfIndex, confidence: 'B', strength: 2,
          evidence: `HTF 하락 추세 유지 중`,
          refs: { price: hc.close, fromBar: h2.barIndex * FACTOR, toBar: ltfIndex }
        })
      }

      // 2) HTF BOS (구조 붕괴)
      if (isUpTrend && hc.close < l2.price && !fired.has(`bos|dn|${ltfIndex}`)) {
        fired.add(`bos|dn|${ltfIndex}`)
        out.push({
          id: 'htf_bos', tier: 3, kind: 'structure', side: 'bearish',
          barIndex: ltfIndex, confidence: 'A', strength: 3,
          evidence: `HTF 직전 저점 ${fmtPrice(l2.price)} 하방 이탈 (BOS)`,
          refs: { price: l2.price, fromBar: l2.barIndex * FACTOR, toBar: ltfIndex }
        })
      } else if (isDnTrend && hc.close > h2.price && !fired.has(`bos|up|${ltfIndex}`)) {
        fired.add(`bos|up|${ltfIndex}`)
        out.push({
          id: 'htf_bos', tier: 3, kind: 'structure', side: 'bullish',
          barIndex: ltfIndex, confidence: 'A', strength: 3,
          evidence: `HTF 직전 고점 ${fmtPrice(h2.price)} 상방 돌파 (BOS)`,
          refs: { price: h2.price, fromBar: h2.barIndex * FACTOR, toBar: ltfIndex }
        })
      }

      // 3) HTF POI (주요 관심 영역 도달 - 간단히 직전 피봇에 도달로 간주)
      if (Math.abs(hc.low - l2.price) / hc.close < 0.002 && !fired.has(`poi|up|${ltfIndex}`)) {
        fired.add(`poi|up|${ltfIndex}`)
        out.push({
          id: 'htf_poi', tier: 3, kind: 'smc', side: 'bullish',
          barIndex: ltfIndex, confidence: 'B', strength: 2,
          evidence: `HTF 주요 저점(POI) ${fmtPrice(l2.price)} 근접`,
          refs: { price: l2.price, fromBar: l2.barIndex * FACTOR, toBar: ltfIndex }
        })
      } else if (Math.abs(hc.high - h2.price) / hc.close < 0.002 && !fired.has(`poi|dn|${ltfIndex}`)) {
        fired.add(`poi|dn|${ltfIndex}`)
        out.push({
          id: 'htf_poi', tier: 3, kind: 'smc', side: 'bearish',
          barIndex: ltfIndex, confidence: 'B', strength: 2,
          evidence: `HTF 주요 고점(POI) ${fmtPrice(h2.price)} 근접`,
          refs: { price: h2.price, fromBar: h2.barIndex * FACTOR, toBar: ltfIndex }
        })
      }
    }
  }

  return out.sort((x, y) => x.barIndex - y.barIndex || x.id.localeCompare(y.id))
}

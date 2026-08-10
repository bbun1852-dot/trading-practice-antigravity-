import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { fmtPrice } from '../format'

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
 * 각 피벗 확정 시점마다 그 시점까지의 정보로 추세를 판정한다.
 * 피벗을 barIndex 오름차순으로 순회하며, 매 피벗의 barIndex를 at이라 할 때
 * barIndex <= at 인 피벗만 사용해 최근 스윙하이 2개와 스윙로우 2개를 비교한다
 * (pivotBar로 거르면 미래참조가 된다 — 확정 전 피벗을 써버리게 된다).
 * HH+HL=상승, LH+LL=하락, 그 외 횡보. 양쪽 모두 2개 이상 모였을 때만 신호를 낸다.
 */
export function detectTrend(cs: Candle[]): Signal[] {
  const pivots = findPivots(cs, 2)
  const out: Signal[] = []
  // 같은 봉에 스윙하이·스윙로우가 동시에 확정될 수 있으므로 barIndex를 중복 없이 순회한다
  // (findPivots는 이미 barIndex 오름차순으로 정렬되어 있다).
  const confirmBars = [...new Set(pivots.map((p) => p.barIndex))]

  for (const at of confirmBars) {
    const available = pivots.filter((p) => p.barIndex <= at)
    const highs = available.filter((p) => p.kind === 'high').slice(-2)
    const lows = available.filter((p) => p.kind === 'low').slice(-2)
    if (highs.length < 2 || lows.length < 2) continue

    const hh = highs[1].price > highs[0].price
    const hl = lows[1].price > lows[0].price
    const lh = highs[1].price < highs[0].price
    const ll = lows[1].price < lows[0].price

    const base = { tier: 3 as const, kind: 'structure' as const, confidence: 'A' as const, barIndex: at }

    if (hh && hl) {
      out.push({ ...base, id: 'trend_up_structure', side: 'bullish', strength: 2,
        evidence: `고점 ${fmtPrice(highs[0].price)}→${fmtPrice(highs[1].price)} 상승, 저점 ${fmtPrice(lows[0].price)}→${fmtPrice(lows[1].price)} 상승 (HH/HL)` })
    } else if (lh && ll) {
      out.push({ ...base, id: 'trend_down_structure', side: 'bearish', strength: 2,
        evidence: `고점 ${fmtPrice(highs[0].price)}→${fmtPrice(highs[1].price)} 하락, 저점 ${fmtPrice(lows[0].price)}→${fmtPrice(lows[1].price)} 하락 (LH/LL)` })
    } else {
      out.push({ ...base, id: 'trend_range', side: 'neutral', strength: 1,
        evidence: '고점·저점이 한 방향으로 정렬되지 않음 (횡보)' })
    }
  }
  return out
}

/**
 * 피벗 가격을 tolerance 내로 묶어 수평 지지·저항 레벨을 만든다.
 *
 * 클러스터 중심을 러닝 민(running mean)으로만 갱신하고 새 피벗을 "그 순간의(이미
 * 이동한) 중심"과만 비교하면, 매 터치가 중심에서 tolerancePct 이내여도 중심 자체가
 * 계속 같은 방향으로 흘러 클러스터 전체 폭이 tolerancePct를 몇 배나 넘어설 수 있다
 * (연쇄적 드리프트). 그래서 여기서는 각 클러스터의 lo/hi 워터마크를 내부적으로
 * 추적하고, 새 피벗을 합류시켰을 때 만들어질 "전체 폭"이 tolerancePct 이내일 때만
 * 합류를 허용한다 — 순간 중심이 아니라 클러스터의 실제 최소/최대 경계 기준.
 */
export function srLevels(cs: Candle[], tolerancePct = 0.005) {
  const pivots = findPivots(cs, 2)
  type Cluster = { lo: number; hi: number; sum: number; touches: number; lastBar: number }
  const clusters: Cluster[] = []
  for (const p of pivots) {
    const hit = clusters.find((c) => {
      const lo = Math.min(c.lo, p.price)
      const hi = Math.max(c.hi, p.price)
      return (hi - lo) / lo <= tolerancePct
    })
    if (hit) {
      hit.lo = Math.min(hit.lo, p.price)
      hit.hi = Math.max(hit.hi, p.price)
      hit.sum += p.price
      hit.touches += 1
      hit.lastBar = Math.max(hit.lastBar, p.barIndex)
    } else {
      clusters.push({ lo: p.price, hi: p.price, sum: p.price, touches: 1, lastBar: p.barIndex })
    }
  }
  return clusters
    .filter((c) => c.touches >= 2)
    .map((c) => ({ price: c.sum / c.touches, touches: c.touches, lastBar: c.lastBar }))
    .sort((a, b) => b.touches - a.touches)
}

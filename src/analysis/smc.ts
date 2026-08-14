import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { atr } from './indicators'
import { findPivots, type Pivot } from './structure'
import { fmtPrice } from '../format'

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
      evidence: `${bullGap ? '상승' : '하락'} FVG ${fmtPrice(lo)}~${fmtPrice(hi)} 미충족`,
      refs: { priceLow: lo, priceHigh: hi, fromBar: i - 2, toBar: i },
    })
  }
  return out
}

/**
 * 같은 barIndex(확정 봉) + 같은 id를 가지며 가격 구간 [priceLow, priceHigh]이
 * 겹치는(경계 접촉 포함) 오더블록들을 하나로 병합한다. 전이적으로 처리한다 —
 * A가 B와 겹치고 B가 C와 겹치면 셋이 한 덩어리다. 겹치지 않는 것은 그대로 남는다.
 */
function mergeOverlappingOrderBlocks(signals: Signal[]): Signal[] {
  const groups = new Map<string, Signal[]>()
  for (const s of signals) {
    const key = `${s.barIndex}|${s.id}`
    const arr = groups.get(key)
    if (arr) arr.push(s)
    else groups.set(key, [s])
  }

  const out: Signal[] = []
  for (const group of groups.values()) {
    if (group.length === 1) { out.push(group[0]); continue }

    // priceLow 오름차순 정렬 후 러닝 하이로 겹침을 스윕하면 전이적 병합이 된다
    // (고전적인 "겹치는 구간 병합" 알고리즘과 동일).
    const sorted = [...group].sort((a, b) => a.refs!.priceLow! - b.refs!.priceLow!)
    let cluster: Signal[] = [sorted[0]]
    let runningHigh = sorted[0].refs!.priceHigh!

    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[i]
      const lo = s.refs!.priceLow!
      if (lo <= runningHigh) {
        cluster.push(s)
        runningHigh = Math.max(runningHigh, s.refs!.priceHigh!)
      } else {
        out.push(mergeCluster(cluster))
        cluster = [s]
        runningHigh = s.refs!.priceHigh!
      }
    }
    out.push(mergeCluster(cluster))
  }
  return out
}

function mergeCluster(cluster: Signal[]): Signal {
  if (cluster.length === 1) return cluster[0]

  const priceLow = Math.min(...cluster.map((s) => s.refs!.priceLow!))
  const priceHigh = Math.max(...cluster.map((s) => s.refs!.priceHigh!))
  const pivotBar = Math.min(...cluster.map((s) => s.refs!.pivotBar!))
  const strength = Math.max(...cluster.map((s) => s.strength)) as 1 | 2 | 3
  const first = cluster[0]
  const label = first.side === 'bullish' ? '상승 지지' : '하락 저항'

  return {
    ...first,
    strength,
    evidence: `겹치는 오더블록 ${cluster.length}개 병합: ${label} 구간 ${fmtPrice(priceLow)}~${fmtPrice(priceHigh)}`,
    refs: { priceLow, priceHigh, pivotBar, fromBar: pivotBar, toBar: first.barIndex },
  }
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
          evidence: `${j - i}봉 뒤 ${((cs[j].close - cs[i].low) / range).toFixed(1)}ATR 상승 임펄스 직전 음봉 (${fmtPrice(cs[i].low)}~${fmtPrice(cs[i].high)})`,
          refs: { priceLow: cs[i].low, priceHigh: cs[i].high, pivotBar: i, fromBar: i, toBar: j },
        })
        break
      }
      if (isUp && cs[j].close < cs[i].low && cs[i].high - cs[j].close >= MIN_IMPULSE * range) {
        out.push({
          id: 'ob_bear_resistance', tier: 1, kind: 'smc', side: 'bearish',
          barIndex: j, confidence: 'A', strength: 3,
          evidence: `${j - i}봉 뒤 ${((cs[i].high - cs[j].close) / range).toFixed(1)}ATR 하락 임펄스 직전 양봉 (${fmtPrice(cs[i].low)}~${fmtPrice(cs[i].high)})`,
          refs: { priceLow: cs[i].low, priceHigh: cs[i].high, pivotBar: i, fromBar: i, toBar: j },
        })
        break
      }
    }
  }
  return mergeOverlappingOrderBlocks(out)
}

/**
 * i 시점에 이미 확정된 피벗 중 가장 최근 것.
 *
 * 인과성의 핵심 조각이라 fibonacci.ts 도 같은 것을 쓴다 — 관측 시점까지 확정된
 * 피벗만 보게 만드는 것이 미래참조를 막는 유일한 방법이다.
 */
export function lastConfirmedPivot(pivots: Pivot[], i: number, kind: 'high' | 'low'): Pivot | undefined {
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
    if (lo && cs[i].low < lo.price && cs[i].close > lo.price) {
      out.push({
        id: 'liq_sweep_low', tier: 1, kind: 'smc', side: 'bullish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `스윙로우 ${fmtPrice(lo.price)} 를 저가 ${fmtPrice(cs[i].low)} 로 이탈 후 종가 ${fmtPrice(cs[i].close)} 로 복귀 (롱 손절 사냥)`,
        refs: { price: lo.price, pivotBar: lo.pivotBar, toBar: i },
      })
    }
    const hi = lastConfirmedPivot(pivots, i, 'high')
    if (hi && cs[i].high > hi.price && cs[i].close < hi.price) {
      out.push({
        id: 'liq_sweep_high', tier: 1, kind: 'smc', side: 'bearish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `스윙하이 ${fmtPrice(hi.price)} 를 고가 ${fmtPrice(cs[i].high)} 로 이탈 후 종가 ${fmtPrice(cs[i].close)} 로 복귀 (숏 손절 사냥)`,
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
  
  let pIdx = 0
  const his: Pivot[] = []
  const los: Pivot[] = []

  for (let i = 0; i < cs.length; i++) {
    // Add pivots strictly before i for trend calculation (matches independentTrend(..., i - 1))
    while (pIdx < pivots.length && pivots[pIdx].barIndex <= i - 1) {
      const p = pivots[pIdx++]
      if (p.kind === 'high') his.push(p)
      else los.push(p)
    }

    let currentTrend: 'up' | 'down' | 'none' = 'none'
    if (los.length >= 2 && his.length >= 2) {
      const l1 = los[los.length - 2]
      const l2 = los[los.length - 1]
      const h1 = his[his.length - 2]
      const h2 = his[his.length - 1]
      if (l2.price > l1.price && h2.price > h1.price) currentTrend = 'up'
      else if (l2.price < l1.price && h2.price < h1.price) currentTrend = 'down'
    }

    // Add pivots at exactly i for breakout targets
    while (pIdx < pivots.length && pivots[pIdx].barIndex === i) {
      const p = pivots[pIdx++]
      if (p.kind === 'high') his.push(p)
      else los.push(p)
    }

    const hi = his.length > 0 ? his[his.length - 1] : undefined
    if (hi && cs[i].close > hi.price && hi.pivotBar > lastBullBreak) {
      lastBullBreak = hi.pivotBar
      // `none`일 때 CHoCH로 마킹하지 않는다. 기존 추세가 없으면 반전이 아니라 돌파(BOS)에 가깝기 때문.
      // 체크포인트 ⑤는 `none`을 판정불가로 집계 제외하므로 게이트 통과에 지장 없음.
      const isChoch = currentTrend === 'down'
      out.push({
        id: isChoch ? 'choch' : 'msb_bull', 
        tier: 1, kind: 'structure', side: 'bullish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: isChoch
          ? `종가 ${fmtPrice(cs[i].close)} 가 직전 스윙하이 ${fmtPrice(hi.price)} 돌파 (CHoCH, 추세 반전)`
          : `종가 ${fmtPrice(cs[i].close)} 가 직전 스윙하이 ${fmtPrice(hi.price)} 상향 돌파 (구조 상승)`,
        refs: { price: hi.price, pivotBar: hi.pivotBar, toBar: i },
      })
    }
    const lo = los.length > 0 ? los[los.length - 1] : undefined
    if (lo && cs[i].close < lo.price && lo.pivotBar > lastBearBreak) {
      lastBearBreak = lo.pivotBar
      const isChoch = currentTrend === 'up'
      out.push({
        id: isChoch ? 'choch' : 'msb_bear', 
        tier: 1, kind: 'structure', side: 'bearish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: isChoch
          ? `종가 ${fmtPrice(cs[i].close)} 가 직전 스윙로우 ${fmtPrice(lo.price)} 이탈 (CHoCH, 추세 반전)`
          : `종가 ${fmtPrice(cs[i].close)} 가 직전 스윙로우 ${fmtPrice(lo.price)} 하향 붕괴 (구조 하락)`,
        refs: { price: lo.price, pivotBar: lo.pivotBar, toBar: i },
      })
    }
  }
  return out
}

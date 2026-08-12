import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { findPivots } from './structure'
import { fmtPrice } from '../format'

/**
 * 상위 타임프레임(HTF) 3종.
 *
 * **이건 진짜 HTF 데이터가 아니라 합성이다.** 주어진 봉을 4개씩 묶어 상위 봉을 만든다.
 * 원래 `htf_*` 3종을 Part 4 까지 미뤄 둔 이유가 "데이터 계층이 필요하다" 였고, 그
 * 계층은 아직 없다. 합성이라 두 가지 한계가 그대로 남는다 —
 *
 * 1. 배수가 4 로 고정이라 1d 차트에서는 실재하지 않는 "4일봉" 이 된다
 * 2. 캘린더가 아니라 **배열 인덱스 0 부터** 4개씩 묶으므로, 데이터 창의 시작이
 *    달라지면 상위 봉의 경계도 달라진다
 *
 * 그래서 세 종 다 **B등급**이다. 사용자가 실제로 상위 차트를 열어 보고 그은 선과
 * 여기서 나온 값이 다를 수 있다. 진짜 HTF 는 별도 파트에서 데이터 계층과 함께 한다.
 */

/** 하위 → 상위 묶음 배수 */
const FACTOR = 4
/** 상위 봉 피벗 확정에 필요한 좌우 봉수 */
const HTF_PIVOT_N = 2
/** POI 로 볼 근접 허용오차 (종가 대비 비율) */
const POI_TOL = 0.002

/**
 * 하위 봉을 묶어 상위 봉으로 만든다.
 *
 * **끝의 불완전한 묶음은 버린다.** 아직 안 닫힌 상위 봉으로 판정하면 같은 자리가
 * 데이터 길이에 따라 다른 답을 낸다. 버리면 상위 봉 i 는 언제나 하위 봉
 * `(i+1)*FACTOR-1` 에서 닫히므로, 어디서 잘라도 같은 봉에서 같은 값이 나온다.
 */
function aggregateCandles(cs: Candle[], factor: number): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i + factor <= cs.length; i += factor) {
    const chunk = cs.slice(i, i + factor)
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, c) => sum + c.volume, 0),
    })
  }
  return out
}

export function detectHTF(cs: Candle[]): Signal[] {
  const out: Signal[] = []

  // **길이로 워밍업을 걸지 않는다.** 원래 `cs.length < 100` 가드가 있었는데, 그건
  // 봉 k 의 답이 k **이후에** 봉이 몇 개나 더 있는지에 달리게 만든다 — 잘라서 주면
  // 가드에 걸려 아무것도 안 내므로 그 자체가 미래참조다. 실제로 이 파트에서
  // assertNoLookAhead 가 bar 91 에서 잡아냈다.
  //
  // 필요한 워밍업은 아래 "확정 피벗이 고·저 각각 2개 이상" 이 이미 인과적으로 건다.
  const htfCandles = aggregateCandles(cs, FACTOR)
  const htfPivots = findPivots(htfCandles, HTF_PIVOT_N)

  /**
   * 직전에 **낸** 추세 방향. 상태가 바뀔 때만 낸다.
   *
   * 고치기 전에는 조건이 참인 모든 상위 봉에서 다시 냈다 — BTCUSDT 4h 실측으로
   * 1000봉당 91회, 발화 간격 90개 중 47개가 정확히 4봉(= 상위 1봉)이었다. 수명이
   * recent(8) 이라 앞뒤가 항상 겹쳐 한 번 켜지면 꺼지지 않았고, 그 결과 htf_trend
   * 하나가 전체 유효 근거의 5.8% 를 먹는 3위 태그가 됐다.
   *
   * 추세 "정렬" 은 상태이지 사건이 아니다. 사건은 **정렬이 바뀐 순간**이다.
   * Part 3 Task 7·Part 4 Task 7 이 이미 두 번 고친 것과 같은 실패다.
   */
  let lastTrend: 'up' | 'down' | undefined

  /** 이미 짚은 자리는 다시 짚지 않는다. 키가 pivotBar 라 인과적이다 */
  const fired = new Set<string>()

  for (let i = 0; i < htfCandles.length; i++) {
    const hc = htfCandles[i]
    /** 이 상위 봉이 닫히는 하위 봉 */
    const ltfIndex = (i + 1) * FACTOR - 1

    // 확정된 상위 피벗만 쓴다 (barIndex = pivotBar + HTF_PIVOT_N).
    const avail = htfPivots.filter((p) => p.barIndex <= i)
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
        barIndex: ltfIndex, confidence: 'B', strength: 2,
        evidence: `HTF 추세가 상승으로 정렬 (저점 ${fmtPrice(l1.price)} → ${fmtPrice(l2.price)})`,
        refs: { price: l2.price, fromBar: l1.pivotBar * FACTOR, toBar: ltfIndex, pivotBar: l2.pivotBar * FACTOR },
      })
    } else if (isDnTrend && lastTrend !== 'down') {
      lastTrend = 'down'
      out.push({
        id: 'htf_trend', tier: 3, kind: 'structure', side: 'bearish',
        barIndex: ltfIndex, confidence: 'B', strength: 2,
        evidence: `HTF 추세가 하락으로 정렬 (고점 ${fmtPrice(h1.price)} → ${fmtPrice(h2.price)})`,
        refs: { price: h2.price, fromBar: h1.pivotBar * FACTOR, toBar: ltfIndex, pivotBar: h2.pivotBar * FACTOR },
      })
    }

    // ── 2) HTF 구조 붕괴 — 자리 하나당 한 번 ─────────────────────────────
    // 키가 ltfIndex 였을 때는 상위 봉마다 키가 달라져 억제가 통째로 무효였다.
    // 뚫린 자리(pivotBar)를 키로 삼아야 같은 자리를 두 번 세지 않는다.
    if (isUpTrend && hc.close < l2.price && !fired.has(`bos|dn|${l2.pivotBar}`)) {
      fired.add(`bos|dn|${l2.pivotBar}`)
      out.push({
        id: 'htf_bos', tier: 3, kind: 'structure', side: 'bearish',
        barIndex: ltfIndex, confidence: 'B', strength: 3,
        evidence: `HTF 직전 저점 ${fmtPrice(l2.price)} 하방 이탈 (BOS)`,
        refs: { price: l2.price, fromBar: l2.pivotBar * FACTOR, toBar: ltfIndex, pivotBar: l2.pivotBar * FACTOR },
      })
    } else if (isDnTrend && hc.close > h2.price && !fired.has(`bos|up|${h2.pivotBar}`)) {
      fired.add(`bos|up|${h2.pivotBar}`)
      out.push({
        id: 'htf_bos', tier: 3, kind: 'structure', side: 'bullish',
        barIndex: ltfIndex, confidence: 'B', strength: 3,
        evidence: `HTF 직전 고점 ${fmtPrice(h2.price)} 상방 돌파 (BOS)`,
        refs: { price: h2.price, fromBar: h2.pivotBar * FACTOR, toBar: ltfIndex, pivotBar: h2.pivotBar * FACTOR },
      })
    }

    // ── 3) HTF 주요 구간(POI) — 첫 터치에서만 ────────────────────────────
    if (Math.abs(hc.low - l2.price) / hc.close < POI_TOL && !fired.has(`poi|lo|${l2.pivotBar}`)) {
      fired.add(`poi|lo|${l2.pivotBar}`)
      out.push({
        id: 'htf_poi', tier: 3, kind: 'smc', side: 'bullish',
        barIndex: ltfIndex, confidence: 'B', strength: 2,
        evidence: `HTF 주요 저점(POI) ${fmtPrice(l2.price)} 첫 도달`,
        refs: { price: l2.price, fromBar: l2.pivotBar * FACTOR, toBar: ltfIndex, pivotBar: l2.pivotBar * FACTOR },
      })
    } else if (Math.abs(hc.high - h2.price) / hc.close < POI_TOL && !fired.has(`poi|hi|${h2.pivotBar}`)) {
      fired.add(`poi|hi|${h2.pivotBar}`)
      out.push({
        id: 'htf_poi', tier: 3, kind: 'smc', side: 'bearish',
        barIndex: ltfIndex, confidence: 'B', strength: 2,
        evidence: `HTF 주요 고점(POI) ${fmtPrice(h2.price)} 첫 도달`,
        refs: { price: h2.price, fromBar: h2.pivotBar * FACTOR, toBar: ltfIndex, pivotBar: h2.pivotBar * FACTOR },
      })
    }
  }

  return out.sort((x, y) => x.barIndex - y.barIndex || x.id.localeCompare(y.id))
}

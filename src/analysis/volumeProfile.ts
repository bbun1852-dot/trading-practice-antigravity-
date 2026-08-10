import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { fmtPrice } from '../format'

/**
 * 볼륨 프로파일 — 매물대(고거래량 노드)와 매물대 공백(저거래량 노드).
 *
 * 관측 시점 i 에서 **뒤쪽 LOOKBACK 봉만** 본다. 창의 min(low)~max(high) 를 BINS 개로
 * 균등 분할하고 거래량을 배분한 뒤, 평균 대비 극단적인 구간을 노드로 낸다.
 *
 * **미래참조를 막는 것이 설계의 핵심 제약이다.** 구간 경계를 전체 기간의 min/max 로 잡으면
 * 뒤에 신고가가 나오는 순간 같은 봉의 refs·evidence 가 통째로 바뀌어 assertNoLookAhead 에
 * 걸린다(동일성 키가 refs 와 evidence 문자열까지 포함한다). 창을 뒤쪽으로만 두면 잘린
 * 실행과 전체 실행이 같은 입력을 보므로 문자열까지 일치한다.
 */

/** 프로파일을 만드는 창의 길이. 이보다 이력이 짧은 봉에서는 발화하지 않는다 */
export const LOOKBACK = 120
/** 창의 가격 범위를 나누는 구간 수 */
export const BINS = 24
/** 구간 평균 거래량의 이 배 이상이면 매물대 */
export const HVN_MULT = 1.8
/** 구간 평균 거래량의 이 배 이하면 매물대 공백 */
export const LVN_MULT = 0.4
/** 이 배를 넘으면 strength 3 */
export const HVN_STRONG_MULT = 3

/** 병합된 노드 구간 */
type Node = { lo: number; hi: number; volume: number; ratio: number }

/**
 * 창의 거래량 프로파일. 각 봉의 거래량을 그 봉의 [low, high] 가 걸치는 구간들에
 * **균등 배분**한다 — 종가 한 점에 몰아주면 장대봉 하나가 특정 가격대를 독점한다.
 * 봉 범위가 0이면(평봉) 그 봉이 속한 구간 하나에 전량 넣는다.
 */
function fillProfile(
  cs: Candle[], from: number, to: number, lo: number, hi: number, bins: number[],
): void {
  bins.fill(0)
  const width = (hi - lo) / BINS
  if (!(width > 0)) return

  /** 가격이 속한 구간 인덱스. hi 는 마지막 구간에 포함시킨다 */
  const binOf = (p: number) => Math.min(BINS - 1, Math.max(0, Math.floor((p - lo) / width)))

  for (let k = from; k <= to; k++) {
    const c = cs[k]
    const first = binOf(c.low)
    const last = binOf(c.high)
    const share = c.volume / (last - first + 1)
    for (let b = first; b <= last; b++) bins[b] += share
  }
}

/** 조건을 만족하는 인접 구간을 하나로 합친다 — 안 하면 구간 폭만큼 신호가 쪼개진다 */
function mergeNodes(
  bins: number[], lo: number, width: number, mean: number, pick: (v: number) => boolean,
): Node[] {
  const out: Node[] = []
  let start = -1
  let volume = 0

  const flush = (endExclusive: number) => {
    if (start < 0) return
    out.push({
      lo: lo + start * width,
      hi: lo + endExclusive * width,
      volume,
      // 병합 구간의 대표 비율은 구간당 평균으로 잡는다 — 합으로 잡으면 넓은 구간이
      // 무조건 강해 보인다
      ratio: mean > 0 ? volume / (endExclusive - start) / mean : 0,
    })
    start = -1
    volume = 0
  }

  for (let b = 0; b < bins.length; b++) {
    if (pick(bins[b])) {
      if (start < 0) start = b
      volume += bins[b]
    } else {
      flush(b)
    }
  }
  flush(bins.length)
  return out
}

export function detectVolumeNodes(cs: Candle[]): Signal[] {
  const out: Signal[] = []

  // 봉마다 새로 할당하지 않고 재사용한다. 함수 지역이라 재진입 문제가 없다.
  const bins = new Array<number>(BINS).fill(0)

  for (let i = LOOKBACK - 1; i < cs.length; i++) {
    const from = i - LOOKBACK + 1

    let lo = Infinity
    let hi = -Infinity
    for (let k = from; k <= i; k++) {
      const c = cs[k]
      if (c.low < lo) lo = c.low
      if (c.high > hi) hi = c.high
    }
    const width = (hi - lo) / BINS
    if (!(width > 0)) continue

    fillProfile(cs, from, i, lo, hi, bins)
    let total = 0
    for (const v of bins) total += v
    if (!(total > 0)) continue
    const mean = total / BINS

    const c = cs[i]
    /** 현재 봉이 그 구간에 닿았는가 */
    const touches = (n: Node) => c.low <= n.hi && c.high >= n.lo

    // 같은 종류는 봉당 하나만 낸다. 여러 구간에 걸치면 가장 극단적인 것을 대표로
    // 삼는다 — 쌍마다 내면 한 봉에서 같은 태그가 여러 번 잡혀 배점이 부풀려진다.
    const hvn = mergeNodes(bins, lo, width, mean, (v) => v >= HVN_MULT * mean)
      .filter(touches)
      .sort((a, b) => b.ratio - a.ratio)[0]

    if (hvn) {
      out.push({
        id: 'volume_node_high', tier: 1, kind: 'volume',
        // 매물대는 위에서 만나면 저항, 아래에서 만나면 지지다. 감지기가 방향을
        // 단정하면 절반은 틀린다.
        side: 'neutral',
        barIndex: i, confidence: 'A',
        strength: hvn.ratio >= HVN_STRONG_MULT ? 3 : 2,
        evidence: `매물대 ${fmtPrice(hvn.lo)}~${fmtPrice(hvn.hi)} — 최근 ${LOOKBACK}봉 구간 평균 거래량의 ${hvn.ratio.toFixed(1)}배`,
        refs: { priceLow: hvn.lo, priceHigh: hvn.hi, fromBar: from, toBar: i },
      })
    }

    const lvn = mergeNodes(bins, lo, width, mean, (v) => v <= LVN_MULT * mean)
      .filter(touches)
      .sort((a, b) => a.ratio - b.ratio)[0]

    if (lvn) {
      out.push({
        id: 'volume_node_low', tier: 1, kind: 'volume', side: 'neutral',
        barIndex: i, confidence: 'A',
        // 공백은 "빠르게 통과한다" 는 뜻이라 단독 진입 근거로는 약하다.
        strength: 1,
        evidence: `매물대 공백 ${fmtPrice(lvn.lo)}~${fmtPrice(lvn.hi)} — 최근 ${LOOKBACK}봉 구간 평균 거래량의 ${lvn.ratio.toFixed(1)}배`,
        refs: { priceLow: lvn.lo, priceHigh: lvn.hi, fromBar: from, toBar: i },
      })
    }
  }

  return out
}

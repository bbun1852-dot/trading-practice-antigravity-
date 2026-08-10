import type { Candle } from '../data/types'
import type { Signal, SignalSide } from './signalTypes'
import { atr } from './indicators'
import { findPivots, type Pivot } from './structure'
import { lastConfirmedPivot, detectOrderBlocks, detectFVG } from './smc'
import { fmtPrice } from '../format'

/**
 * 피보나치 되돌림·확장.
 *
 * **레그 선택이 이 감지기의 인과성 전부다.** "전체에서 가장 큰 스윙" 으로 고르면
 * 뒤에 더 큰 스윙이 나오는 순간 같은 봉의 evidence 가 바뀌어 assertNoLookAhead 에
 * 걸린다(동일성 키가 evidence 문자열까지 포함한다). 그래서 관측 시점 i 에서
 * **확정된 피벗 두 개**(마지막 고점·마지막 저점)로만 레그를 정한다 — 이 둘은 i 시점에
 * 이미 확정돼 있으므로 이후 봉이 무엇이든 값이 변하지 않는다.
 */

/** 레그가 이 배수의 ATR 보다 작으면 무시한다 — 노이즈에 피보를 그리지 않는다 */
export const MIN_LEG_ATR = 2.0

/** 확장 비율. 1.272 도 흔히 쓰이나 발화율을 보고 6번 태스크에서 정한다 */
export const EXTENSION_RATIO = 1.618

const RETRACE: Array<{ id: string; ratio: number; strength: 1 | 2 | 3 }> = [
  { id: 'fib_retrace_382', ratio: 0.382, strength: 1 },
  { id: 'fib_retrace_5', ratio: 0.5, strength: 2 },
  // 노트가 골든 포켓을 가장 중시한다
  { id: 'fib_retrace_618', ratio: 0.618, strength: 3 },
]

/** 관측 시점 i 의 레그. 확정 피벗 두 개로만 정해진다 */
export type Leg = {
  start: Pivot
  end: Pivot
  /** 레그 크기 */
  range: number
  up: boolean
}

/** i 시점에 확정된 마지막 고점·저점으로 레그를 만든다. 없거나 너무 작으면 undefined */
export function legAt(pivots: Pivot[], i: number, atrAt: number): Leg | undefined {
  const hi = lastConfirmedPivot(pivots, i, 'high')
  const lo = lastConfirmedPivot(pivots, i, 'low')
  if (!hi || !lo) return undefined
  if (!Number.isFinite(atrAt) || atrAt <= 0) return undefined

  // 같은 봉이 스윙하이와 스윙로우로 동시에 확정될 수 있다(structure.ts 의 detectTrend 가
  // 같은 이유로 barIndex 를 중복 없이 순회한다). 그 경우 레그의 시작과 끝이 한 봉이 되어
  // "구간" 이 성립하지 않으므로 레그로 보지 않는다.
  if (lo.pivotBar === hi.pivotBar) return undefined

  // 나중에 찍힌 쪽이 레그의 끝이다
  const up = lo.pivotBar < hi.pivotBar
  const start = up ? lo : hi
  const end = up ? hi : lo
  const range = Math.abs(end.price - start.price)
  if (range < MIN_LEG_ATR * atrAt) return undefined

  return { start, end, range, up }
}

/** 중첩 판정에서 이보다 오래된 구간은 보지 않는다 */
export const CONFLUENCE_MAX_AGE = 50

/** 봉이 그 가격을 지나갔는가 */
const touches = (c: Candle, price: number) => c.low <= price && price <= c.high

export function detectFibonacci(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  const pivots = findPivots(cs, 2)
  const a = atr(cs, 14)

  // 중첩 판정용 수급 구간. 같은 계층이라 의존 방향 위반이 아니고, 두 감지기 다
  // 인과적이라 미래참조도 없다.
  const zones = [...detectOrderBlocks(cs), ...detectFVG(cs)]
    .filter((s) => s.refs?.priceLow !== undefined && s.refs?.priceHigh !== undefined)

  for (let i = 0; i < cs.length; i++) {
    const leg = legAt(pivots, i, a[i])
    if (!leg) continue

    const c = cs[i]
    const { start, end, range, up } = leg
    const legText = `${up ? '상승' : '하락'} 레그 ${fmtPrice(start.price)}→${fmtPrice(end.price)}`
    // 되돌림은 레그 끝에서 반대 방향으로 잰다. 상승 레그의 되돌림 자리는 지지
    // 후보이므로 bullish, 하락 레그는 저항 후보이므로 bearish 다.
    const side: SignalSide = up ? 'bullish' : 'bearish'

    /** 그 가격이 i 시점에 살아 있는 수급 구간 안에 드는가 */
    const inZone = (price: number) => zones.some((z) =>
      z.barIndex <= i && i - z.barIndex <= CONFLUENCE_MAX_AGE &&
      price >= z.refs!.priceLow! && price <= z.refs!.priceHigh!)

    let confluenceAt: { level: number; ratio: number } | undefined

    for (const r of RETRACE) {
      const level = up ? end.price - r.ratio * range : end.price + r.ratio * range
      if (!touches(c, level)) continue
      out.push({
        id: r.id, tier: 3, kind: 'fib', side,
        barIndex: i, confidence: 'A', strength: r.strength,
        evidence: `${legText} 의 ${(r.ratio * 100).toFixed(1)}% 되돌림 ${fmtPrice(level)} 터치`,
        refs: { price: level, fromBar: start.pivotBar, toBar: end.pivotBar },
      })
      // 가장 깊은 되돌림 하나만 중첩 후보로 삼는다 — 봉당 하나만 낸다
      if (!confluenceAt && inZone(level)) confluenceAt = { level, ratio: r.ratio }
    }

    if (confluenceAt) {
      out.push({
        id: 'fib_confluence', tier: 3, kind: 'fib', side,
        barIndex: i, confidence: 'A',
        // 중첩 자체가 신호다. 겹친 상대의 tier 를 따르지 않는다.
        strength: 3,
        // **어떤 구간과 겹쳤는지는 적지 않는다.** detectFVG 는 나중에 메워진 FVG 를
        // 배출하지 않으므로 잘린 실행이 전체 실행보다 구간을 더 많이 볼 수 있다.
        // 겹친 상대를 문구에 넣으면 두 실행의 evidence 가 갈려 assertNoLookAhead 에
        // 걸린다(동일성 키가 evidence 를 포함한다). "겹쳤다" 는 사실 자체는 전체 실행이
        // 참이면 잘린 실행도 반드시 참이라 안전하다.
        evidence: `${legText} 의 ${(confluenceAt.ratio * 100).toFixed(1)}% 되돌림 ${fmtPrice(confluenceAt.level)} 이 오더블록/FVG 구간과 중첩`,
        refs: { price: confluenceAt.level, fromBar: start.pivotBar, toBar: end.pivotBar },
      })
    }

    // 확장은 레그 시작점에서 방향대로 잰다 — 레그 끝을 넘어선 목표다.
    const ext = up ? start.price + EXTENSION_RATIO * range : start.price - EXTENSION_RATIO * range
    if (touches(c, ext)) {
      out.push({
        id: 'fib_extension', tier: 3, kind: 'fib',
        // 목표 도달은 레그 방향과 같은 편이다
        side: up ? 'bullish' : 'bearish',
        barIndex: i, confidence: 'A', strength: 2,
        evidence: `${legText} 의 ${(EXTENSION_RATIO * 100).toFixed(1)}% 확장 ${fmtPrice(ext)} 도달`,
        refs: { price: ext, fromBar: start.pivotBar, toBar: end.pivotBar },
      })
    }
  }

  return out
}

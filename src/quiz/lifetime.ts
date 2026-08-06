import type { Candle } from '../data/types'
import type { Signal } from '../analysis/signalTypes'
import { detectSignals } from '../analysis/signals'
import { TAG_BY_ID, type LifetimeClass } from './taxonomy'

export type ActiveSignal = Signal & { ageBars: number }

/** zone 구간이 barIndex+1..atIndex 사이에 무효화되었는가 */
function zoneInvalidated(
  cs: Candle[], s: Signal, atIndex: number, mode: 'touch' | 'close_through',
): boolean {
  const lo = s.refs?.priceLow
  const hi = s.refs?.priceHigh
  if (lo === undefined || hi === undefined) return false

  for (let j = s.barIndex + 1; j <= atIndex && j < cs.length; j++) {
    const c = cs[j]
    if (mode === 'touch') {
      if (c.low <= hi && c.high >= lo) return true
    } else {
      // 종가가 구간을 완전히 통과해 마감 = 오더블록이 깨짐
      if (s.side === 'bullish' && c.close < lo) return true
      if (s.side === 'bearish' && c.close > hi) return true
    }
  }
  return false
}

function isAlive(cs: Candle[], s: Signal, atIndex: number, lt: LifetimeClass): boolean {
  const age = atIndex - s.barIndex
  switch (lt.kind) {
    case 'bar':    return age === 0
    case 'recent': return age < lt.bars
    case 'state':  return true   // 최신 1개 선별은 호출부에서 한다
    case 'zone':   return age <= lt.maxBars && !zoneInvalidated(cs, s, atIndex, lt.invalidateOn)
  }
}

/**
 * 주어진 신호 목록에 수명 규칙을 적용한다.
 * 스캐너 1단계처럼 신호를 미리 계산해 둔 경우에 쓴다.
 */
export function filterActive(cs: Candle[], signals: Signal[], atIndex: number): ActiveSignal[] {
  const out: ActiveSignal[] = []
  const latestState = new Map<string, Signal>()

  for (const s of signals) {
    if (s.barIndex > atIndex) continue          // 미래 신호는 무조건 배제
    const def = TAG_BY_ID.get(s.id)
    if (!def) continue                          // taxonomy 에 없는 id 는 채점 대상이 아니다
    if (!isAlive(cs, s, atIndex, def.lifetime)) continue

    if (def.lifetime.kind === 'state') {
      const prev = latestState.get(s.id)
      if (!prev || s.barIndex > prev.barIndex) latestState.set(s.id, s)
      continue
    }
    out.push({ ...s, ageBars: atIndex - s.barIndex })
  }

  for (const s of latestState.values()) {
    out.push({ ...s, ageBars: atIndex - s.barIndex })
  }

  return out.sort((a, b) => a.barIndex - b.barIndex || a.id.localeCompare(b.id))
}

/**
 * atIndex 시점의 유효 근거 집합. **채점과 스캐너 2단계의 유일한 진입점이다.**
 * detectAll(cs).filter() 지름길을 여기서 쓰면 안 된다 — 상태 의존 신호(미충족 FVG 등)가
 * 관측 시점에 따라 정당하게 달라지므로 두 경로는 동치가 아니다.
 */
export function activeSignalsAt(cs: Candle[], atIndex: number): ActiveSignal[] {
  return filterActive(cs, detectSignals(cs, atIndex), atIndex)
}

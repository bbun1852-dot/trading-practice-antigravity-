import { describe, it, expect } from 'vitest'
import { detectAll, detectSignals } from './signals'
import { assertNoLookAhead } from './testing'
import { synthCandles } from './fixtures'

describe('detectAll', () => {
  const candles = synthCandles(300)

  it('barIndex 오름차순으로 정렬되어 나온다', () => {
    const sigs = detectAll(candles)
    const sorted = [...sigs].sort((a, b) => a.barIndex - b.barIndex)
    expect(sigs.map((s) => s.barIndex)).toEqual(sorted.map((s) => s.barIndex))
  })

  it('어떤 신호도 미래 봉을 가리키지 않는다', () => {
    expect(detectAll(candles).every((s) => s.barIndex < candles.length)).toBe(true)
  })

  it('통합 감지기 전체가 look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectAll, candles)
  })
})

describe('detectSignals', () => {
  it('atIndex 이후 봉은 절대 사용하지 않는다', () => {
    const candles = synthCandles(300)
    const at = 180
    const partial = detectSignals(candles, at)
    expect(partial.every((s) => s.barIndex <= at)).toBe(true)
    // 뒤쪽 봉을 완전히 바꿔도 결과가 같아야 한다
    const tampered = [...candles.slice(0, at + 1), ...synthCandles(119, 999)]
    expect(detectSignals(tampered, at)).toEqual(partial)
  })
})

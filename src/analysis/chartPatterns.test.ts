import { describe, it, expect } from 'vitest'
import { detectChartPatterns } from './chartPatterns'
import type { Candle } from '../data/types'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'

/** from → to 로 bars 개의 봉을 만든다. 꼬리는 ±0.3 고정이라 ATR 이 안정적이다 */
function leg(cs: Candle[], from: number, to: number, bars: number) {
  const step = (to - from) / bars
  let p = from
  for (let i = 0; i < bars; i++) {
    const open = p
    p += step
    cs.push(mk(open, Math.max(open, p) + 0.3, Math.min(open, p) - 0.3, p, 100, cs.length))
  }
}

/**
 * 홀로 선 꼭짓점 봉 하나. findPivots 는 등호를 인정하지 않으므로(`<=` 면 탈락)
 * 이웃보다 확실히 튀어나온 봉을 따로 넣어야 피벗이 잡힌다.
 */
function apex(cs: Candle[], price: number, up: boolean) {
  cs.push(up
    ? mk(price, price + 1.5, price - 0.3, price - 0.2, 100, cs.length)
    : mk(price, price + 0.3, price - 1.5, price + 0.2, 100, cs.length))
}

describe('detectChartPatterns', () => {
  it('빈 배열이면 빈 배열 반환', () => {
    expect(detectChartPatterns([])).toEqual([])
  })

  it('룩어헤드 편향이 없어야 한다', () => {
    assertNoLookAhead(detectChartPatterns, synthCandles(400))
  })

  it('이중 천정 — 같은 높이 봉우리 둘과 넥라인 붕괴', () => {
    const cs: Candle[] = []
    leg(cs, 100, 102, 6)      // 워밍업
    leg(cs, 102, 100, 6)
    leg(cs, 100, 110, 10)     // 1차 상승
    apex(cs, 110, true)       // 봉우리 1
    leg(cs, 109.8, 104, 8)    // 넥라인까지 하락
    apex(cs, 104, false)      // 골 = 넥라인
    leg(cs, 104.2, 110, 8)    // 2차 상승
    apex(cs, 110, true)       // 봉우리 2 (같은 높이)
    leg(cs, 109.8, 98, 10)    // 넥라인 붕괴

    const dt = detectChartPatterns(cs).filter((s) => s.id === 'pattern_double_top')
    expect(dt).toHaveLength(1)
    expect(dt[0].side).toBe('bearish')
    // 넥라인은 골의 저가다. 붕괴 봉은 그보다 뒤에 있어야 한다.
    expect(dt[0].barIndex).toBeGreaterThan(dt[0].refs!.fromBar!)
  })

  it('이중 바닥 — 이중 천정의 거울상', () => {
    const cs: Candle[] = []
    leg(cs, 100, 98, 6)
    leg(cs, 98, 100, 6)
    leg(cs, 100, 90, 10)
    apex(cs, 90, false)
    leg(cs, 90.2, 96, 8)
    apex(cs, 96, true)
    leg(cs, 95.8, 90, 8)
    apex(cs, 90, false)
    leg(cs, 90.2, 102, 10)

    const db = detectChartPatterns(cs).filter((s) => s.id === 'pattern_double_bottom')
    expect(db).toHaveLength(1)
    expect(db[0].side).toBe('bullish')
  })

  /**
   * 같은 그림을 두 번 세지 않는다. 발화 억제 키가 확정 피벗 쌍이므로 한 패턴은
   * 한 번만 나야 한다 — Part 3·4 에서 반복된 실패(조건이 참인 동안 매 봉 발화)를
   * 여기서 고정한다.
   */
  it('같은 패턴을 두 번 내지 않는다', () => {
    const sigs = detectChartPatterns(synthCandles(2000))
    expect(sigs.length).toBeGreaterThan(0)

    const keys = sigs.map((s) => `${s.id}|${s.refs?.fromBar}|${s.refs?.price}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('결정론 — 같은 입력이면 같은 출력', () => {
    const cs = synthCandles(600)
    expect(detectChartPatterns(cs)).toEqual(detectChartPatterns(cs))
  })
})

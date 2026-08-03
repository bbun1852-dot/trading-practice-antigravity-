import { describe, it, expect } from 'vitest'
import { detectCandlePatterns } from './candlePatterns'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'

const idsAt = (cs: Parameters<typeof detectCandlePatterns>[0], i: number) =>
  detectCandlePatterns(cs).filter((s) => s.barIndex === i).map((s) => s.id)

describe('detectCandlePatterns', () => {
  it('망치형: 아래꼬리가 몸통의 2배 이상', () => {
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 101, 90, 100.5, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_hammer')
  })

  it('유성형: 위꼬리가 몸통의 2배 이상인 음봉', () => {
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 110, 99.5, 99.5, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_shooting_star')
  })

  it('상승 장악형: 음봉을 다음 양봉이 완전히 감싼다', () => {
    const cs = [mk(100, 101, 97, 98, 100, 0), mk(97.5, 103, 97, 102, 200, 1)]
    expect(idsAt(cs, 1)).toContain('candle_bull_engulf')
  })

  it('하락 장악형: 양봉을 다음 음봉이 완전히 감싼다', () => {
    const cs = [mk(98, 101, 97, 100, 100, 0), mk(100.5, 101, 96, 97, 200, 1)]
    expect(idsAt(cs, 1)).toContain('candle_bear_engulf')
  })

  it('적삼병: 계단식 상승 양봉 3개', () => {
    const cs = [
      mk(100, 104, 99.5, 103, 100, 0),
      mk(103, 108, 102.5, 107, 100, 1),
      mk(107, 112, 106.5, 111, 100, 2),
    ]
    expect(idsAt(cs, 2)).toContain('candle_three_soldiers')
  })

  it('샛별형: 음봉 → 작은 몸통 → 되돌리는 양봉', () => {
    const cs = [
      mk(110, 110.5, 99, 100, 100, 0),
      mk(99.5, 100.5, 99, 100, 100, 1),
      mk(100, 108, 99.5, 107, 200, 2),
    ]
    expect(idsAt(cs, 2)).toContain('candle_morning_star')
  })

  it('인사이드바: 직전 봉 레인지 안에 들어간다', () => {
    const cs = [mk(100, 110, 90, 105, 100, 0), mk(102, 108, 95, 104, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_inside_bar')
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectCandlePatterns, synthCandles(220))
  })
})

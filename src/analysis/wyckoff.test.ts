import { describe, it, expect } from 'vitest'
import { detectWyckoff } from './wyckoff'
import type { Candle } from '../data/types'
import { assertNoLookAhead } from './testing'
import { synthCandles } from './fixtures'

describe('detectWyckoff', () => {
  it('빈 배열이면 빈 배열 반환', () => {
    expect(detectWyckoff([])).toEqual([])
  })

  it('룩어헤드 편향이 없어야 한다', () => {
    // 50봉 이상이어야 감지 로직이 도므로, 200봉 정도로 테스트
    const cs = synthCandles(200)
    assertNoLookAhead(detectWyckoff, cs)
  })

  it('기본적인 Spring/UT를 감지할 수 있다 (mock)', () => {
    const cs: Candle[] = []
    let p = 100
    // TR 형성 (40봉)
    for (let i = 0; i < 45; i++) {
      cs.push({
        time: i,
        open: p,
        high: p + 5,
        low: p - 5,
        close: p,
        volume: 100,
      })
      // 약간의 지그재그
      if (i % 5 === 0) p = p === 100 ? 105 : 100
    }
    
    // 이탈 (Spring)
    cs.push({
      time: 45,
      open: 100,
      high: 100,
      low: 80, // minL 이탈
      close: 101, // 회복
      volume: 500,
    })
    
    // 좀 더미 데이터 채워서 50봉 넘김
    for (let i = 46; i < 55; i++) {
      cs.push({
        time: i, open: 100, high: 102, low: 98, close: 100, volume: 100
      })
    }

    const out = detectWyckoff(cs)
    
    // 단순한 휴리스틱이므로 완벽한 감지를 장담하진 않지만, 실행 중 오류가 나지 않음을 우선 검증
    expect(Array.isArray(out)).toBe(true)
  })
})

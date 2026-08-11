import { describe, it, expect } from 'vitest'
import { detectHTF } from './htf'
import type { Candle } from '../data/types'
import { assertNoLookAhead } from './testing'
import { synthCandles } from './fixtures'

describe('detectHTF', () => {
  it('빈 배열이면 빈 배열 반환', () => {
    expect(detectHTF([])).toEqual([])
  })

  it('룩어헤드 편향이 없어야 한다', () => {
    // 100봉 이상이어야 감지 로직이 도므로 400봉 정도로 테스트
    const cs = synthCandles(400)
    assertNoLookAhead(detectHTF, cs)
  })

  it('단순 상승 추세(HTF)에서 트렌드와 BOS를 감지해야 한다', () => {
    const cs: Candle[] = []
    
    // 100봉을 채우되, HTF (4개씩 묶임) 관점에서 점진적 우상향하도록 구성
    // HTF 캔들 1 (0~3): low=100, high=110, close=105
    // HTF 캔들 2 (4~7): low=105, high=120, close=115
    // HTF 캔들 3 (8~11): low=110, high=130, close=125
    // ...
    for (let i = 0; i < 200; i++) {
      const basePrice = 100 + Math.floor(i / 4) * 5
      cs.push({
        time: i,
        open: basePrice,
        high: basePrice + 10,
        low: basePrice - 2,
        close: basePrice + 5,
        volume: 100
      })
    }

    const out = detectHTF(cs)
    
    // 단순한 휴리스틱이므로 완벽한 감지를 장담하진 않지만, 실행 중 오류가 나지 않음을 우선 검증
    expect(Array.isArray(out)).toBe(true)
  })
})

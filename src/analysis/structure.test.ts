import { describe, it, expect } from 'vitest'
import { findPivots, detectTrend, srLevels } from './structure'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'

describe('findPivots', () => {
  it('명확한 봉우리를 스윙 하이로 잡고 확정 시점을 pivot+n으로 기록한다', () => {
    // 인덱스 4가 봉우리
    const cs = [
      mk(10, 11, 9, 10), mk(10, 12, 9, 11), mk(11, 13, 10, 12),
      mk(12, 14, 11, 13), mk(13, 20, 12, 19), mk(19, 15, 12, 13),
      mk(13, 14, 11, 12), mk(12, 13, 10, 11),
    ]
    const highs = findPivots(cs, 2).filter((p) => p.kind === 'high')
    expect(highs).toContainEqual({ barIndex: 6, pivotBar: 4, price: 20, kind: 'high' })
  })

  it('확정에 필요한 오른쪽 봉이 없으면 피벗을 만들지 않는다', () => {
    const cs = [mk(10, 11, 9, 10), mk(10, 20, 9, 19), mk(19, 15, 12, 13)]
    expect(findPivots(cs, 2)).toEqual([])
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(
      (cs) => findPivots(cs, 2).map((p) => ({
        id: `pivot_${p.kind}`, tier: 3 as const, kind: 'structure' as const,
        side: 'neutral' as const, barIndex: p.barIndex, confidence: 'A' as const,
        strength: 1 as const, evidence: String(p.price),
      })),
      synthCandles(220),
    )
  })
})

describe('detectTrend', () => {
  it('계단식 상승이면 상승추세를 낸다', () => {
    // 브리프 원본 픽스처(mk(100+i, 102+i, 99+i, 101+i, 100, i))는 매 봉마다 OHLC가
    // 정확히 +1씩만 오르는 순수 단조증가 수열이라, 2봉 프랙탈 감지기로는 내부 극값을
    // 절대 찾을 수 없다(항상 다음 봉이 더 높으므로 좌우 모두보다 높은 봉이 존재할 수
    // 없음) — findPivots가 항상 빈 배열을 반환해 이 테스트를 통과 불가능하게 만드는
    // 픽스처 결함이다. srLevels 테스트에서 이미 검증된 사이클 모양(랠리 후 되돌림)을
    // 사이클마다 위로 이동시켜, 실제로 상승하는 스윙하이/스윙로우(HH/HL)를 만든다.
    const cs = []
    for (let k = 0; k < 10; k++) {
      const b = k * 15
      cs.push(mk(100 + b, 105 + b, 99 + b, 104 + b, 100, cs.length))
      cs.push(mk(104 + b, 110 + b, 103 + b, 109 + b, 100, cs.length))
      cs.push(mk(109 + b, 120 + b, 108 + b, 119 + b, 100, cs.length)) // 고점
      cs.push(mk(119 + b, 119.5 + b, 108 + b, 109 + b, 100, cs.length))
      cs.push(mk(109 + b, 110 + b, 100 + b, 101 + b, 100, cs.length))
      cs.push(mk(101 + b, 102 + b, 99 + b, 100 + b, 100, cs.length))
    }
    const sigs = detectTrend(cs)
    expect(sigs.some((s) => s.id === 'trend_up_structure')).toBe(true)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectTrend, synthCandles(220))
  })
})

describe('srLevels', () => {
  it('같은 가격을 반복 터치하면 하나의 레벨로 묶고 터치 횟수를 센다', () => {
    // 같은 고점(120)을 세 번 찍는 톱니 형태
    const cs = []
    for (let k = 0; k < 3; k++) {
      cs.push(mk(100, 105, 99, 104, 100, k * 6 + 0))
      cs.push(mk(104, 110, 103, 109, 100, k * 6 + 1))
      cs.push(mk(109, 120, 108, 119, 100, k * 6 + 2))  // 고점 120
      cs.push(mk(119, 119.5, 108, 109, 100, k * 6 + 3))
      cs.push(mk(109, 110, 100, 101, 100, k * 6 + 4))
      cs.push(mk(101, 102, 99, 100, 100, k * 6 + 5))
    }
    const levels = srLevels(cs, 0.005)
    const near120 = levels.find((l) => Math.abs(l.price - 120) < 1)
    expect(near120).toBeDefined()
    expect(near120!.touches).toBeGreaterThanOrEqual(2)
  })

  it('터치가 1회뿐인 가격은 레벨로 인정하지 않는다', () => {
    const cs = [
      mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1),
      mk(100, 150, 99, 149, 100, 2),   // 단 한 번의 고점
      mk(149, 150, 99, 100, 100, 3), mk(100, 101, 99, 100, 100, 4),
    ]
    expect(srLevels(cs).every((l) => l.touches >= 2)).toBe(true)
  })
})

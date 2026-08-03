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

  // ── F2 회귀: 마지막 피벗에서만 신호를 내면 detectAll(cs).filter(s => s.barIndex <= D)
  // 형태(스펙 5.2(1)/9(1)의 미래참조 불변식)가 추세 신호를 통째로 놓친다. 리뷰어가
  // D = 120/180/240/300/360 다섯 지점에서 실측했다 — 여기서 동일하게 재현한다.
  describe('회귀: 모든 피벗 확정 시점마다 신호를 내야 한다 (F2)', () => {
    const cs = synthCandles(400)
    for (const D of [120, 180, 240, 300, 360]) {
      it(`D=${D}: 절단 필터에 추세 신호가 남아 있고 절단 실행의 마지막 신호와 id가 같다`, () => {
        const truncated = detectTrend(cs.slice(0, D + 1))
        const full = detectTrend(cs).filter((s) => s.barIndex <= D)
        expect(full.length).toBeGreaterThan(0)
        expect(truncated.length).toBeGreaterThan(0)
        expect(full[full.length - 1].id).toBe(truncated[truncated.length - 1].id)
      })
    }
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

  it('클러스터 전체 폭이 tolerancePct를 넘지 않는다 (러닝 민 드리프트 회귀)', () => {
    // 리뷰어가 지적한 시나리오: 매 터치를 '현재(이미 이동한) 클러스터 중심'의 허용오차
    // 경계에 딱 걸치도록 그리디하게 배치하면, 러닝 민(running mean) 기반 클러스터링은
    // 10번째 터치까지 첫 터치 대비 계속 걸어나간다 — tolerancePct(0.5%)의 약 3배인 1.4%.
    const tol = 0.005
    const peaks: number[] = [100]
    {
      let center = 100
      for (let k = 1; k < 10; k++) {
        const next = center * (1 + tol) * 0.999999 // (구)버그 판정 경계 바로 안쪽
        peaks.push(next)
        center = (center * k + next) / (k + 1) // (구)버그의 러닝 민 갱신과 동일
      }
    }

    // 각 목표 고점을 이미 검증된 사이클 모양(랠리 후 되돌림)으로 감싼다. n=2 확정
    // 창이 사이클(6봉) 밖으로 나가지 않으므로 사이클마다 정확히 확정 고점 피벗
    // 하나만 생기고, 그 값은 peaks[k]와 정확히 같다.
    const cs = []
    for (const P of peaks) {
      const delta = P - 120
      cs.push(mk(100 + delta, 105 + delta, 99 + delta, 104 + delta, 100, cs.length))
      cs.push(mk(104 + delta, 110 + delta, 103 + delta, 109 + delta, 100, cs.length))
      cs.push(mk(109 + delta, 120 + delta, 108 + delta, 119 + delta, 100, cs.length)) // 고점 = P
      cs.push(mk(119 + delta, 119.5 + delta, 108 + delta, 109 + delta, 100, cs.length))
      cs.push(mk(109 + delta, 110 + delta, 100 + delta, 101 + delta, 100, cs.length))
      cs.push(mk(101 + delta, 102 + delta, 99 + delta, 100 + delta, 100, cs.length))
    }

    const levels = srLevels(cs, tol)

    // 반환 타입에는 lo/hi가 없다(내부 부기일 뿐). 대신 우리가 직접 만든 정답
    // (peaks, 오름차순 단조증가)에서 연속 구간을 재구성해 실제 폭을 검증한다 —
    // 가격이 단조증가이고 확정 순서(barIndex)도 동일한 순서이므로, 한 번 닫힌
    // 클러스터에는 이후 더 큰 값이 다시 합류할 수 없어 각 레벨은 peaks의 연속
    // 구간 하나에 정확히 대응한다.
    function findMatchingWindow(values: number[], level: { price: number; touches: number }) {
      for (let start = 0; start + level.touches <= values.length; start++) {
        const w = values.slice(start, start + level.touches)
        const mean = w.reduce((a, b) => a + b, 0) / w.length
        if (Math.abs(mean - level.price) < 1e-6) return w
      }
      return null
    }

    const nearZone = levels.filter((l) => Math.abs(l.price - peaks[0]) < 10)
    expect(nearZone.length).toBeGreaterThan(0)

    let accountedTouches = 0
    for (const level of nearZone) {
      const w = findMatchingWindow(peaks, level)
      expect(w).not.toBeNull()
      const span = (w![w!.length - 1] - w![0]) / w![0]
      expect(span).toBeLessThanOrEqual(tol + 1e-9)
      accountedTouches += level.touches
    }
    // 10개 터치 전부가 (경계 없는 단일 거대 클러스터가 아니라) 폭이 tolerancePct로
    // 제한된 여러 레벨로 빠짐없이 나뉘어 들어갔는지 확인한다.
    expect(accountedTouches).toBe(peaks.length)
    // 버그가 있던 러닝 민 방식이 만들어내던, 첫 터치 대비 폭이 tolerancePct의 거의
    // 3배(약 1.4%)까지 걸어나간 단일 10터치 클러스터는 더는 없어야 한다.
    expect(nearZone.some((l) => l.touches === peaks.length)).toBe(false)
  })
})

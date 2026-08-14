import { describe, it, expect } from 'vitest'
import { detectHTF } from './htf'
import { assertNoLookAhead } from './testing'
import { synthCandles } from './fixtures'

describe('detectHTF', () => {
  const hc2000 = synthCandles(400, 999, 14400 * 6)
  
  it('빈 배열이면 빈 배열 반환', () => {
    expect(detectHTF([], '4h', hc2000, '1d')).toEqual([])
  })

  it('룩어헤드 편향이 없어야 한다', () => {
    assertNoLookAhead((cs) => detectHTF(cs, '4h', hc2000, '1d'), synthCandles(400))
  })

  /**
   * 이 파트가 고친 결함을 고정한다. 고치기 전에는 조건이 참인 상위 봉마다 다시 내서
   * 같은 방향이 연달아 수십 번 나왔다 (BTC 4h 1000봉당 91회, 간격 47/90 이 4봉).
   * 정렬이 **바뀐 순간**에만 내면 방향은 반드시 번갈아 나온다.
   */
  it('htf_trend 는 정렬이 바뀔 때만 난다 — 같은 방향이 연달아 나오지 않는다', () => {
    const trend = detectHTF(synthCandles(2000), '4h', hc2000, '1d').filter((s) => s.id === 'htf_trend')
    expect(trend.length).toBeGreaterThan(0)

    for (let i = 1; i < trend.length; i++) {
      expect(trend[i].side).not.toBe(trend[i - 1].side)
    }
  })

  it('같은 자리는 두 번 짚지 않는다 — bos/poi 가 자리마다 한 번', () => {
    const sigs = detectHTF(synthCandles(2000), '4h', hc2000, '1d')
    for (const id of ['htf_bos', 'htf_poi']) {
      const keys = sigs.filter((s) => s.id === id).map((s) => `${s.side}|${s.refs?.pivotBar}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  /**
   * refs 는 사용자가 차트에 그릴 좌표다. Pivot.barIndex 는 확정 시점(pivotBar + n)이라
   * 그걸 쓰면 실제 피벗보다 하위 8봉 뒤를 가리킨다 — 선이 엉뚱한 데서 시작한다.
   */
  it('refs 가 확정 시점이 아니라 실제 피벗 위치를 가리킨다', () => {
    const sigs = detectHTF(synthCandles(2000), '4h', hc2000, '1d')
    expect(sigs.length).toBeGreaterThan(0)

    for (const s of sigs) {
      // 상위 봉 경계로 묶었으므로(1d = 6 * 4h), 하위 인덱스는 6의 배수여야 한다.
      expect(s.refs?.fromBar! % 6).toBe(0)
      expect(s.refs?.fromBar).toBeLessThanOrEqual(s.barIndex)
    }
  })
})

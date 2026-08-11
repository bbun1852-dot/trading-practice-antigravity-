import { describe, it, expect } from 'vitest'
import { detectIndicatorExtras, WALK_RUN, LOOKBACK } from './indicatorExtras'
import { assertNoLookAhead } from './testing'
import { mk, synthCandles } from './fixtures'
import type { Candle } from '../data/types'

const cs = synthCandles(800)
const sigs = detectIndicatorExtras(cs)
const ids = new Set(sigs.map((s) => s.id))

describe('detectIndicatorExtras — 미래참조', () => {
  it('assertNoLookAhead 를 통과한다 (공허하지 않게)', () => {
    expect(() => assertNoLookAhead(detectIndicatorExtras, synthCandles(600))).not.toThrow()
  })

  it('결정 시점 이후 봉을 바꿔도 그 시점의 신호가 그대로다', () => {
    const base = synthCandles(400)
    const all = detectIndicatorExtras(base)
    const at = all.map((s) => s.barIndex).find((b) => b >= 200 && b < 350)
    expect(at, '검사에 쓸 신호가 없다').toBeDefined()
    const before = all.filter((s) => s.barIndex === at)

    const tampered = [...base]
    for (let i = at! + 1; i < tampered.length; i++) tampered[i] = mk(500, 900, 100, 800, 9999, i)
    expect(detectIndicatorExtras(tampered).filter((s) => s.barIndex === at)).toEqual(before)
  })
})

describe('detectIndicatorExtras — 8종이 실제로 발화한다', () => {
  // 하나라도 안 나오면 사용자가 체크하는 족족 확정 ❌ 가 된다 (인계문서 2절)
  for (const id of ['bb_walking', 'macd_hist_turn', 'ma_support', 'ma_resistance',
    'obv_trend_confirm', 'vol_divergence']) {
    it(`${id} 가 나온다`, () => {
      expect(ids.has(id), `${id} 가 픽스처에서 한 번도 안 나온다`).toBe(true)
    })
  }

  it('rsi_failure_swing 은 조건이 까다로우니 더 긴 픽스처로 확인한다', () => {
    const long = detectIndicatorExtras(synthCandles(3000))
    expect(long.some((s) => s.id === 'rsi_failure_swing')).toBe(true)
  })
})

describe('bb_walking — 런이 도달한 봉에서만', () => {
  it('밴드 밖 연속이 길어져도 봉마다 반복해서 내지 않는다', () => {
    const walks = sigs.filter((s) => s.id === 'bb_walking')
    expect(walks.length).toBeGreaterThan(0)
    // 연속한 두 bb_walking 이 바로 옆 봉이면 런 도중에 또 낸 것이다
    const bars = walks.map((s) => s.barIndex).sort((a, b) => a - b)
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i] - bars[i - 1], `bar ${bars[i]} 에서 런 도중 재발화`).toBeGreaterThan(1)
    }
    expect(WALK_RUN).toBeGreaterThan(1)
  })
})

describe('detectIndicatorExtras — 출력 계약', () => {
  it('한 봉에서 같은 id 가 두 번 나오지 않는다', () => {
    const seen = new Set<string>()
    for (const s of sigs) {
      const k = `${s.barIndex}|${s.id}`
      expect(seen.has(k), `중복 배출: ${k}`).toBe(false)
      seen.add(k)
    }
  })

  /**
   * synthCandles 의 거래량은 100~500(평균 300)이라 **구조적으로 평균의 2배에 도달할 수
   * 없다.** 감지기가 아니라 픽스처의 한계이므로 손으로 만든 봉으로 검사한다.
   */
  const absorptionFixture = (volume: number, high: number, low: number, close: number): Candle[] => [
    ...Array.from({ length: 25 }, (_, i) => mk(100, 101, 99, 100, 100, i)),
    mk(100, high, low, close, volume, 25),
  ]

  it('대량 거래에도 몸통이 좁으면 흡수를 낸다 — 그리고 중립이다', () => {
    const got = detectIndicatorExtras(absorptionFixture(400, 105, 95, 100.5))
      .filter((s) => s.id === 'vol_absorption')
    expect(got, '흡수가 감지되지 않았다').toHaveLength(1)
    // 매집인지 분산인지는 위치가 정하지 감지기가 정하지 않는다 (매물대와 같은 이유)
    expect(got[0].side).toBe('neutral')
  })

  it('거래량이 평균의 2배에 못 미치면 내지 않는다', () => {
    const got = detectIndicatorExtras(absorptionFixture(150, 105, 95, 100.5))
    expect(got.some((s) => s.id === 'vol_absorption')).toBe(false)
  })

  it('거래량이 많아도 몸통이 크면 흡수가 아니다', () => {
    const got = detectIndicatorExtras(absorptionFixture(400, 105, 95, 104.5))
    expect(got.some((s) => s.id === 'vol_absorption')).toBe(false)
  })

  it('워밍업 구간에서는 창 기반 신호를 내지 않는다', () => {
    const windowed = ['obv_trend_confirm', 'vol_divergence', 'vol_absorption']
    for (const s of sigs) {
      if (windowed.includes(s.id)) expect(s.barIndex).toBeGreaterThanOrEqual(LOOKBACK)
    }
  })

  it('evidence 가 비어 있지 않다', () => {
    expect(sigs.every((s) => s.evidence.length > 0)).toBe(true)
  })
})

describe('detectIndicatorExtras — 경계', () => {
  const cases: Array<[string, Candle[]]> = [
    ['빈 배열', []],
    ['1봉', [mk(100, 101, 99, 100, 100, 0)]],
    ['평봉 300개', Array.from({ length: 300 }, (_, i) => mk(100, 100, 100, 100, 100, i))],
    ['거래량 0', Array.from({ length: 300 }, (_, i) => mk(100, 101, 99, 100, 0, i))],
  ]
  for (const [name, c] of cases) {
    it(`${name} 에서 예외도 이상값도 없다`, () => {
      const got = detectIndicatorExtras(c)
      expect(got.every((s) => !s.evidence.includes('NaN') && !s.evidence.includes('Infinity'))).toBe(true)
    })
  }
})

import { describe, it, expect } from 'vitest'
import { filterActive, activeSignalsAt } from './lifetime'
import type { Signal } from '../analysis/signalTypes'
import { mk, synthCandles } from '../analysis/fixtures'

const flat = (n: number, price = 100) =>
  Array.from({ length: n }, (_, i) => mk(price, price + 1, price - 1, price, 100, i))

const sig = (id: string, barIndex: number, over: Partial<Signal> = {}): Signal => ({
  id, tier: 4, kind: 'candle', side: 'bullish', barIndex,
  confidence: 'A', strength: 1, evidence: '', ...over,
})

describe('수명 클래스', () => {
  it('bar: 그 봉에서만 유효하다', () => {
    const cs = flat(30)
    const s = [sig('candle_doji', 20, { side: 'neutral' })]
    expect(filterActive(cs, s, 20).map(x => x.id)).toEqual(['candle_doji'])
    expect(filterActive(cs, s, 21)).toEqual([])
  })

  it('recent: N봉 이내만 유효하다', () => {
    const cs = flat(30)
    const s = [sig('liq_sweep_low', 20, { tier: 1, kind: 'smc' })]
    expect(filterActive(cs, s, 24)).toHaveLength(1)   // ageBars 4 < 5
    expect(filterActive(cs, s, 25)).toHaveLength(0)   // ageBars 5
  })

  it('state: 같은 id 중 최신 1개만 남긴다', () => {
    const cs = flat(30)
    const s = [
      sig('ma_aligned_bull', 10, { kind: 'ma' }),
      sig('ma_aligned_bull', 15, { kind: 'ma' }),
      sig('ma_aligned_bull', 18, { kind: 'ma' }),
    ]
    const out = filterActive(cs, s, 25)
    expect(out).toHaveLength(1)
    expect(out[0].barIndex).toBe(18)
  })

  it('state: 관측 시점 이후의 것은 쓰지 않는다', () => {
    const cs = flat(30)
    const s = [sig('ma_aligned_bull', 10, { kind: 'ma' }), sig('ma_aligned_bull', 22, { kind: 'ma' })]
    const out = filterActive(cs, s, 15)
    expect(out).toHaveLength(1)
    expect(out[0].barIndex).toBe(10)
  })

  it('zone close_through: 종가가 구간 아래로 마감하면 무효 (bullish)', () => {
    const cs = flat(30)
    cs[24] = mk(100, 101, 88, 89, 100, 24)   // 종가 89 < priceLow 95
    const s = [sig('ob_bull_support', 20, {
      tier: 1, kind: 'smc', refs: { priceLow: 95, priceHigh: 99 },
    })]
    expect(filterActive(cs, s, 23)).toHaveLength(1)
    expect(filterActive(cs, s, 25)).toHaveLength(0)
  })

  it('zone close_through: 종가가 구간 위로 마감하면 무효 (bearish)', () => {
    const cs = flat(30)
    cs[24] = mk(100, 112, 99, 111, 100, 24)   // 종가 111 > priceHigh 105
    const s = [sig('ob_bear_resistance', 20, {
      side: 'bearish', tier: 1, kind: 'smc', refs: { priceLow: 95, priceHigh: 105 },
    })]
    expect(filterActive(cs, s, 23)).toHaveLength(1)   // 아직 안 깨짐
    expect(filterActive(cs, s, 25)).toHaveLength(0)   // 깨짐
  })

  it('zone close_through: bearish 구간은 반대 방향(구간 아래)으로 마감해도 무효화되지 않는다', () => {
    const cs = flat(30)
    cs[24] = mk(100, 101, 88, 89, 100, 24)   // 종가 89 < priceLow 95 — bullish 무효화 조건이지 bearish 조건이 아니다
    const s = [sig('ob_bear_resistance', 20, {
      side: 'bearish', tier: 1, kind: 'smc', refs: { priceLow: 95, priceHigh: 105 },
    })]
    expect(filterActive(cs, s, 25)).toHaveLength(1)   // bearish 는 위로 뚫려야 깨진다
  })

  it('zone: maxBars 를 넘으면 무효', () => {
    const cs = flat(200)
    const s = [sig('ob_bull_support', 20, {
      tier: 1, kind: 'smc', refs: { priceLow: 95, priceHigh: 99 },
    })]
    expect(filterActive(cs, s, 69)).toHaveLength(1)    // ageBars 49
    expect(filterActive(cs, s, 71)).toHaveLength(0)    // ageBars 51 > 50
  })

  it('taxonomy 에 없는 id 는 버린다', () => {
    const cs = flat(30)
    expect(filterActive(cs, [sig('존재하지_않는_태그', 20)], 20)).toEqual([])
  })

  it('ageBars 를 채운다', () => {
    const cs = flat(30)
    const out = filterActive(cs, [sig('liq_sweep_low', 20, { tier: 1, kind: 'smc' })], 23)
    expect(out[0].ageBars).toBe(3)
  })

  it('미래 신호는 절대 통과시키지 않는다', () => {
    const cs = flat(30)
    expect(filterActive(cs, [sig('candle_doji', 25, { side: 'neutral' })], 20)).toEqual([])
  })
})

describe('activeSignalsAt', () => {
  it('총량을 크게 줄인다', () => {
    const cs = synthCandles(400)
    const active = activeSignalsAt(cs, 340)
    // 수명 없이는 수백 개다. 목표는 8~15개이며 Task 5에서 조정한다.
    expect(active.length).toBeGreaterThan(0)
    expect(active.length).toBeLessThan(60)
  })

  it('결정 시점 이후 봉을 바꿔도 결과가 같다 (미래참조 없음)', () => {
    const cs = synthCandles(400)
    const before = activeSignalsAt(cs, 200)
    const tampered = [...cs]
    for (let i = 201; i < tampered.length; i++) {
      tampered[i] = mk(1, 2, 0.5, 1.5, 999, i)
    }
    expect(activeSignalsAt(tampered, 200)).toEqual(before)
  })
})

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

  // Task 5 실측으로 recent 가 두 단이 됐다: 구조·SMC 사건과 지표의 순간 사건.
  // 아래 두 테스트는 각 단의 경계를 **리터럴로** 고정한다 — 상수를 그대로 참조하면
  // 값이 바뀔 때 검사도 함께 따라 내려가 아무것도 지키지 못한다.
  // Part 4 재확정: 구조계 14 → 10 (태그가 71종이 되며 유효 근거가 대역을 벗어났다).
  it('recent(구조계): 10봉 이내만 유효하다', () => {
    const cs = flat(40)
    const s = [sig('liq_sweep_low', 20, { tier: 1, kind: 'smc' })]
    expect(filterActive(cs, s, 29)).toHaveLength(1)   // ageBars 9 < 10
    expect(filterActive(cs, s, 30)).toHaveLength(0)   // ageBars 10
  })

  // ma_aligned_bull 은 리뷰 finding 2 에서 bar 로 재분류됐다 (매봉 재평가되는
  // 조건이라 영구 상태가 아님). state 는 이제 trend_up/down/range 처럼 진짜
  // 상호배타적 상태값에만 쓰인다 — 아래 테스트들은 trend_up_structure 로 옮겨서
  // 기존에 검증하던 두 동작(최신 우선, 미래 배제)을 그대로 유지한다.
  it('state: 같은 그룹 중 최신 1개만 남긴다', () => {
    const cs = flat(30)
    const s = [
      sig('trend_up_structure', 10, { tier: 3, kind: 'structure' }),
      sig('trend_up_structure', 15, { tier: 3, kind: 'structure' }),
      sig('trend_up_structure', 18, { tier: 3, kind: 'structure' }),
    ]
    const out = filterActive(cs, s, 25)
    expect(out).toHaveLength(1)
    expect(out[0].barIndex).toBe(18)
  })

  it('state: 관측 시점 이후의 것은 쓰지 않는다', () => {
    const cs = flat(30)
    const s = [
      sig('trend_up_structure', 10, { tier: 3, kind: 'structure' }),
      sig('trend_up_structure', 22, { tier: 3, kind: 'structure' }),
    ]
    const out = filterActive(cs, s, 15)
    expect(out).toHaveLength(1)
    expect(out[0].barIndex).toBe(10)
  })

  it('state: 같은 그룹 안에서는 id 가 달라도 최신 1개로 수렴한다 (배타 그룹)', () => {
    const cs = flat(30)
    // trend_up/down/range 는 group('trend') 로 묶인 상호배타적 세 값이다.
    // 예전엔 세 id 가 서로 달라서 전부 살아남았다 — 지금은 최신 1개만 남아야 한다.
    const s = [
      sig('trend_up_structure', 10, { tier: 3, kind: 'structure' }),
      sig('trend_down_structure', 18, { tier: 3, kind: 'structure', side: 'bearish' }),
    ]
    const out = filterActive(cs, s, 25)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('trend_down_structure')
    expect(out[0].barIndex).toBe(18)
  })

  it('state: 배타 그룹 3종이 섞여도 결국 최신 1개만 남는다', () => {
    const cs = flat(30)
    const s = [
      sig('trend_up_structure', 10, { tier: 3, kind: 'structure' }),
      sig('trend_range', 20, { tier: 3, kind: 'structure', side: 'neutral' }),
      sig('trend_down_structure', 24, { tier: 3, kind: 'structure', side: 'bearish' }),
    ]
    const out = filterActive(cs, s, 25)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('trend_down_structure')
  })

  it('bar: 매봉 재평가 태그(ma_aligned_bull)는 그 봉에서만 유효하다', () => {
    const cs = flat(30)
    const s = [sig('ma_aligned_bull', 20, { tier: 4, kind: 'ma' })]
    expect(filterActive(cs, s, 20)).toHaveLength(1)
    expect(filterActive(cs, s, 21)).toHaveLength(0)   // 20봉에서만 유효 — 21봉엔 없다
  })

  it('recent(순간계): 엣지 이벤트 태그(rsi_overbought)는 4봉을 넘기면 사라진다', () => {
    const cs = flat(30)
    const s = [sig('rsi_overbought', 20, { tier: 4, kind: 'momentum', side: 'bearish' })]
    expect(filterActive(cs, s, 23)).toHaveLength(1)   // ageBars 3 < 4
    expect(filterActive(cs, s, 24)).toHaveLength(0)   // ageBars 4 — 70선을 넘던 순간은 지나갔다
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

  // Part 4 재확정: zone maxBars 50 → 30 (오더블록 2종이 유효 근거의 23% 를 차지했다).
  it('zone: maxBars 를 넘으면 무효', () => {
    const cs = flat(200)
    const s = [sig('ob_bull_support', 20, {
      tier: 1, kind: 'smc', refs: { priceLow: 95, priceHigh: 99 },
    })]
    expect(filterActive(cs, s, 49)).toHaveLength(1)    // ageBars 29
    expect(filterActive(cs, s, 51)).toHaveLength(0)    // ageBars 31 > 30
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

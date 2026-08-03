import { describe, it, expect } from 'vitest'
import { sma, ema, rsi, atr, obv, bollinger } from './indicators'
import type { Candle } from '../data/types'

const c = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  ({ time: 0, open: o, high: h, low: l, close: cl, volume: v })

describe('sma', () => {
  it('워밍업 구간은 NaN이고 이후 단순평균이다', () => {
    const out = sma([1, 2, 3, 4, 5], 3)
    expect(out.length).toBe(5)
    expect(out[0]).toBeNaN()
    expect(out[1]).toBeNaN()
    expect(out[2]).toBeCloseTo(2)
    expect(out[3]).toBeCloseTo(3)
    expect(out[4]).toBeCloseTo(4)
  })
})

describe('ema', () => {
  it('첫 유효값은 SMA이고 이후 지수평활한다', () => {
    const out = ema([1, 2, 3, 4, 5], 3)
    expect(out[2]).toBeCloseTo(2)
    // k = 2/(3+1) = 0.5 → 4*0.5 + 2*0.5 = 3
    expect(out[3]).toBeCloseTo(3)
    expect(out[4]).toBeCloseTo(4)
  })
})

describe('rsi', () => {
  it('연속 상승이면 100에 수렴한다', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i)
    const out = rsi(rising, 14)
    expect(out[29]).toBeCloseTo(100, 0)
  })

  it('연속 하락이면 0에 수렴한다', () => {
    const falling = Array.from({ length: 30 }, (_, i) => 100 - i)
    const out = rsi(falling, 14)
    expect(out[29]).toBeCloseTo(0, 0)
  })
})

describe('atr', () => {
  it('일정한 레인지면 그 레인지값이 된다', () => {
    const cs = Array.from({ length: 30 }, () => c(100, 105, 95, 100))
    const out = atr(cs, 14)
    expect(out[29]).toBeCloseTo(10)
  })
})

describe('obv', () => {
  it('종가 상승 시 거래량을 더하고 하락 시 뺀다', () => {
    const out = obv([c(1, 1, 1, 10, 100), c(1, 1, 1, 11, 50), c(1, 1, 1, 9, 30)])
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(50)
    expect(out[2]).toBe(20)
  })
})

describe('bollinger', () => {
  it('변동이 없으면 상하단이 중심선과 같다', () => {
    const flat = Array.from({ length: 25 }, () => 100)
    const out = bollinger(flat, 20, 2)
    expect(out.mid[24]).toBeCloseTo(100)
    expect(out.upper[24]).toBeCloseTo(100)
    expect(out.lower[24]).toBeCloseTo(100)
  })
})

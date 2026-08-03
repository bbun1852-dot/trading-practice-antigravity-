import { describe, it, expect } from 'vitest'
import { detectIndicatorSignals } from './indicatorSignals'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'
import type { Candle } from '../data/types'

describe('detectIndicatorSignals', () => {
  it('연속 상승 후 RSI 과매수 진입을 잡는다', () => {
    const cs: Candle[] = []
    for (let i = 0; i < 20; i++) {
      const c = i % 2 === 0 ? 100 : 99
      cs.push(mk(c, c + 1, c - 1, c, 100, i))
    }
    for (let i = 20; i < 45; i++) cs.push(mk(100 + i, 102 + i, 99 + i, 101 + i, 100, i))
    expect(detectIndicatorSignals(cs).some((s) => s.id === 'rsi_overbought')).toBe(true)
  })

  it('거래량이 20봉 평균의 2배 이상이면 돌파 확인 신호를 낸다', () => {
    const cs: Candle[] = []
    for (let i = 0; i < 30; i++) cs.push(mk(100, 101, 99, 100, 100, i))
    cs.push(mk(100, 106, 99.5, 105.5, 270, 30))
    const s = detectIndicatorSignals(cs).find((x) => x.id === 'vol_breakout_confirm')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(30)
  })

  it('큰 몸통인데 거래량이 평균 미만이면 가짜 돌파 신호를 낸다', () => {
    const cs: Candle[] = []
    for (let i = 0; i < 30; i++) cs.push(mk(100, 103, 97, 100, 300, i))
    cs.push(mk(100, 112, 99, 111, 50, 30))
    expect(detectIndicatorSignals(cs).some((x) => x.id === 'vol_breakout_weak')).toBe(true)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectIndicatorSignals, synthCandles(220))
  })
})

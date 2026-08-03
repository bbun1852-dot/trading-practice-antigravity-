import { describe, it, expect } from 'vitest'
import { detectFVG, detectOrderBlocks } from './smc'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'

describe('detectFVG', () => {
  it('상승 갭을 잡고 갭 구간을 refs에 담는다', () => {
    // i=2의 저가(15)가 i=0의 고가(10)보다 위 → 상승 FVG [10, 15]
    const cs = [mk(8, 10, 7, 9), mk(9, 16, 9, 15), mk(15, 20, 15, 19), mk(19, 21, 18, 20)]
    const sigs = detectFVG(cs)
    const bull = sigs.find((s) => s.id === 'fvg_bull')
    expect(bull).toBeDefined()
    expect(bull!.barIndex).toBe(2)
    expect(bull!.refs).toMatchObject({ priceLow: 10, priceHigh: 15 })
  })

  it('이후 가격이 갭을 메우면 신호를 내지 않는다', () => {
    const cs = [mk(8, 10, 7, 9), mk(9, 16, 9, 15), mk(15, 20, 15, 19), mk(19, 20, 9, 10)]
    expect(detectFVG(cs).some((s) => s.id === 'fvg_bull')).toBe(false)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectFVG, synthCandles(220))
  })
})

describe('detectOrderBlocks', () => {
  it('상승 임펄스 직전 음봉을 강세 오더블록으로 잡는다', () => {
    const flat = Array.from({ length: 20 }, (_, i) => mk(100, 101, 99, 100, 100, i))
    const cs = [
      ...flat,
      mk(100, 100.5, 98, 98.5, 100, 20),   // 20: 음봉 = OB 후보
      mk(98.5, 106, 98, 105, 300, 21),     // 21: 강한 상승 돌파
      mk(105, 107, 104, 106, 200, 22),
    ]
    const sigs = detectOrderBlocks(cs)
    const ob = sigs.find((s) => s.id === 'ob_bull_support')
    expect(ob).toBeDefined()
    expect(ob!.barIndex).toBe(21)
    expect(ob!.refs?.pivotBar).toBe(20)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectOrderBlocks, synthCandles(220))
  })
})

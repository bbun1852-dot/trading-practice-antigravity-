import { describe, it, expect } from 'vitest'
import { parseKlines } from './binance'

describe('parseKlines', () => {
  it('ms epoch을 초 단위로 변환하고 문자열 가격을 숫자로 만든다', () => {
    const raw = [
      [1785700800000, '63456.00', '63796.33', '63344.00', '63570.00', '1419.60',
       1785715199999, '90220771.40', 329091, '760.24', '48315907.60', '0'],
    ]
    expect(parseKlines(raw)).toEqual([
      { time: 1785700800, open: 63456, high: 63796.33, low: 63344, close: 63570, volume: 1419.6 },
    ])
  })

  it('빈 배열을 그대로 통과시킨다', () => {
    expect(parseKlines([])).toEqual([])
  })
})

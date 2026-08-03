import { describe, it, expect } from 'vitest'
import { cacheKey } from './cache'

describe('cacheKey', () => {
  it('인자 조합마다 고유한 키를 만든다', () => {
    expect(cacheKey('BTCUSDT', '4h', 1785700800, 400)).toBe('BTCUSDT|4h|1785700800|400')
  })

  it('다른 endTime이면 다른 키가 된다', () => {
    const a = cacheKey('BTCUSDT', '4h', 1785700800, 400)
    const b = cacheKey('BTCUSDT', '4h', 1785700801, 400)
    expect(a).not.toBe(b)
  })
})

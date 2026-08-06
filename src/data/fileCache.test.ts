import { describe, it, expect, afterEach } from 'vitest'
import { rmSync, existsSync } from 'node:fs'
import { cachePath, readCache, writeCache } from './fileCache'
import { mk } from '../analysis/fixtures'

const SYM = '__TEST__'

afterEach(() => {
  const p = cachePath(SYM, '4h', 10)
  if (existsSync(p)) rmSync(p)
})

describe('파일 캔들 캐시', () => {
  it('쓰고 읽으면 같은 값이 나온다', () => {
    const cs = Array.from({ length: 10 }, (_, i) => mk(1 + i, 2 + i, 0.5 + i, 1.5 + i, 100, i))
    writeCache(SYM, '4h', 10, cs)
    expect(readCache(SYM, '4h', 10)).toEqual(cs)
  })

  it('없으면 null 을 낸다', () => {
    expect(readCache(SYM, '4h', 10)).toBeNull()
  })
})

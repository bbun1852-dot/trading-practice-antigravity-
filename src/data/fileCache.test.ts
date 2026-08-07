import { describe, it, expect, afterEach } from 'vitest'
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { cachePath, readCache, writeCache } from './fileCache'
import { mk } from '../analysis/fixtures'

/** 실제 심볼과 절대 겹치지 않는 일회용 이름. 테스트가 남기는 파일은 이것뿐이다. */
const SYM = '__TEST__'
const TF = '4h' as const
const LIMIT = 10

const P = cachePath(SYM, TF, LIMIT)

const candles = () =>
  Array.from({ length: LIMIT }, (_, i) => mk(1 + i, 2 + i, 0.5 + i, 1.5 + i, 100, i))

/** 검증 경로를 찌르기 위해 캐시 파일에 임의의 내용을 직접 박아 넣는다 */
function putRaw(text: string): void {
  mkdirSync(dirname(P), { recursive: true })
  writeFileSync(P, text, 'utf8')
}

afterEach(() => {
  rmSync(P, { force: true })
  rmSync(`${P}.tmp`, { force: true })
})

describe('파일 캔들 캐시', () => {
  it('쓰고 읽으면 같은 값이 나온다', () => {
    const cs = candles()
    writeCache(SYM, TF, LIMIT, cs)
    expect(readCache(SYM, TF, LIMIT)).toEqual(cs)
  })

  it('파일이 없으면 null 을 낸다', () => {
    expect(existsSync(P)).toBe(false)
    expect(readCache(SYM, TF, LIMIT)).toBeNull()
  })
})

/**
 * 캐시는 최적화지 진실의 출처가 아니다. 아래는 전부 "예외 없이 캐시 미스로 격하되고,
 * 망가진 파일은 지워져서 같은 실패가 되풀이되지 않는다" 를 확인한다.
 */
describe('망가진 캐시는 예외가 아니라 미스가 된다', () => {
  const cases: { name: string; raw: string }[] = [
    {
      name: 'JSON 이 깨졌다 (쓰다 만 파일)',
      raw: '[{"time":1,"open":1,"high":2,"low":0,"clo',
    },
    {
      name: 'JSON 은 멀쩡한데 봉투가 아니다 (옛 포맷: 알맹이 배열을 그대로 저장)',
      raw: JSON.stringify(candles()),
    },
    {
      name: '봉투도 배열도 아닌 값',
      raw: '"문자열"',
    },
    {
      name: '포맷 버전이 다르다',
      raw: JSON.stringify({ version: 999, symbol: SYM, tf: TF, limit: LIMIT, candles: candles() }),
    },
    {
      name: '요청 파라미터가 다르다 (limit 불일치)',
      raw: JSON.stringify({ version: 1, symbol: SYM, tf: TF, limit: 777, candles: candles() }),
    },
    {
      name: '요청 파라미터가 다르다 (symbol 불일치)',
      raw: JSON.stringify({ version: 1, symbol: 'OTHER', tf: TF, limit: LIMIT, candles: candles() }),
    },
    {
      name: '캔들 배열이 비었다',
      raw: JSON.stringify({ version: 1, symbol: SYM, tf: TF, limit: LIMIT, candles: [] }),
    },
    {
      name: '캔들에 필드가 빠졌다 (volume 없음)',
      raw: JSON.stringify({
        version: 1, symbol: SYM, tf: TF, limit: LIMIT,
        candles: [{ time: 1, open: 1, high: 2, low: 0, close: 1.5 }],
      }),
    },
    {
      name: '캔들 필드가 숫자가 아니다 (문자열)',
      raw: JSON.stringify({
        version: 1, symbol: SYM, tf: TF, limit: LIMIT,
        candles: [{ time: 1, open: '1', high: 2, low: 0, close: 1.5, volume: 100 }],
      }),
    },
    {
      name: '캔들 필드가 유한수가 아니다 (null → NaN 자리)',
      raw: JSON.stringify({
        version: 1, symbol: SYM, tf: TF, limit: LIMIT,
        candles: [{ time: 1, open: null, high: 2, low: 0, close: 1.5, volume: 100 }],
      }),
    },
    {
      name: 'time 이 증가하지 않는다 (중복)',
      raw: JSON.stringify({
        version: 1, symbol: SYM, tf: TF, limit: LIMIT,
        candles: [mk(1, 2, 0.5, 1.5, 100, 0), mk(1, 2, 0.5, 1.5, 100, 0)],
      }),
    },
    {
      name: 'time 이 증가하지 않는다 (역순)',
      raw: JSON.stringify({
        version: 1, symbol: SYM, tf: TF, limit: LIMIT,
        candles: [mk(1, 2, 0.5, 1.5, 100, 5), mk(1, 2, 0.5, 1.5, 100, 1)],
      }),
    },
  ]

  for (const c of cases) {
    it(`${c.name} → 예외 없이 null`, () => {
      putRaw(c.raw)
      expect(() => readCache(SYM, TF, LIMIT)).not.toThrow()
      expect(readCache(SYM, TF, LIMIT)).toBeNull()
    })
  }

  it('검증에 실패한 파일은 지워진다 (같은 실패를 되풀이하지 않는다)', () => {
    putRaw('{ 깨진 json')
    expect(existsSync(P)).toBe(true)
    expect(readCache(SYM, TF, LIMIT)).toBeNull()
    expect(existsSync(P)).toBe(false)
  })

  it('망가진 파일을 지운 자리에 다시 쓰면 정상 동작한다', () => {
    putRaw(JSON.stringify({ version: 999, symbol: SYM, tf: TF, limit: LIMIT, candles: candles() }))
    expect(readCache(SYM, TF, LIMIT)).toBeNull()

    const cs = candles()
    writeCache(SYM, TF, LIMIT, cs)
    expect(readCache(SYM, TF, LIMIT)).toEqual(cs)
  })

  it('같은 파라미터로 쓴 뒤 다른 파라미터로 읽으면 미스다', () => {
    writeCache(SYM, TF, LIMIT, candles())
    // 다른 limit 은 다른 경로라 애초에 파일이 없다 — 파일 이름과 봉투 양쪽으로 막힌다.
    expect(readCache(SYM, TF, LIMIT + 1)).toBeNull()
    expect(readCache(SYM, TF, LIMIT)).not.toBeNull()
  })

  it('쓰기는 임시 파일을 남기지 않는다', () => {
    writeCache(SYM, TF, LIMIT, candles())
    expect(existsSync(`${P}.tmp`)).toBe(false)
    expect(existsSync(P)).toBe(true)
  })
})

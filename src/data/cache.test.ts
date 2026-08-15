/**
 * 브라우저 캔들 캐시의 계약 — fileCache 와 같은 의미론을 fake-indexeddb 위에서 잠근다.
 *
 * 원칙은 하나다: **망가진 캐시는 예외가 아니라 미스가 된다.** 그리고 실패한 항목은
 * 지워져서 같은 실패를 되풀이하지 않는다. 각 실패 모드를 직접 심어서 확인한다.
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import type { Candle } from './types'
import {
  CACHE_VERSION, DB_NAME, STORE,
  cacheKey, getCandles, readCache, writeCache, resetDbConnectionForTests,
} from './cache'
import { fetchKlines } from './binance'

vi.mock('./binance', () => ({ fetchKlines: vi.fn() }))
const mockFetch = vi.mocked(fetchKlines)

const candles = (n: number, from = 0): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: 1600000000 + (from + i) * 14400, open: 100, high: 101, low: 99, close: 100, volume: 10,
  }))

/** 오염 항목을 캐시 모듈과 같은 DB 에 직접 심는다 (fileCache 테스트가 파일을 직접 쓰듯).
 *  새 팩토리에서 먼저 열릴 수 있으므로 스토어 생성 upgrade 를 갖춰야 한다. */
const rawDb = () => openDB(DB_NAME, 2, {
  upgrade(d) {
    if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
  },
})

async function rawPut(key: string, value: unknown): Promise<void> {
  const d = await rawDb()
  await d.put(STORE, value, key)
  d.close()
}

async function rawGet(key: string): Promise<unknown> {
  const d = await rawDb()
  const v: unknown = await d.get(STORE, key)
  d.close()
  return v
}

const KEY = cacheKey('BTCUSDT', '4h', 123, 400)

beforeEach(() => {
  // 테스트마다 새 팩토리 — 모듈이 잡고 있는 이전 연결도 같이 버린다
  globalThis.indexedDB = new IDBFactory()
  resetDbConnectionForTests()
  mockFetch.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('cacheKey', () => {
  it('인자 조합마다 고유한 키를 만들고, endTime 생략은 latest 로 구별된다', () => {
    expect(cacheKey('BTCUSDT', '4h', 1785700800, 400)).toBe('BTCUSDT|4h|1785700800|400')
    expect(cacheKey('BTCUSDT', '4h', null, 400)).toBe('BTCUSDT|4h|latest|400')
    expect(cacheKey('BTCUSDT', '4h', 1785700800, 400))
      .not.toBe(cacheKey('BTCUSDT', '4h', 1785700801, 400))
  })
})

describe('왕복', () => {
  it('write → read 가 같은 캔들을 돌려준다', async () => {
    const cs = candles(50)
    await writeCache('BTCUSDT', '4h', 400, cs, 123)
    expect(await readCache('BTCUSDT', '4h', 400, 123)).toEqual(cs)
  })

  it('endTime 을 생략한 항목과 고정한 항목은 서로 다른 항목이다', async () => {
    await writeCache('BTCUSDT', '4h', 400, candles(5))
    expect(await readCache('BTCUSDT', '4h', 400, 123)).toBeNull()
    expect(await readCache('BTCUSDT', '4h', 400)).toHaveLength(5)
  })
})

describe('망가진 캐시는 예외가 아니라 미스가 된다', () => {
  it('생 배열(스파이크 시절 모양) → 봉투가 아니므로 폐기된다', async () => {
    await rawPut(KEY, candles(10))
    expect(await readCache('BTCUSDT', '4h', 400, 123)).toBeNull()
    expect(await rawGet(KEY)).toBeUndefined()   // 지워졌다
  })

  it('포맷 버전 불일치 → 폐기', async () => {
    await rawPut(KEY, {
      version: CACHE_VERSION + 99, symbol: 'BTCUSDT', tf: '4h', limit: 400, endTime: 123,
      candles: candles(10),
    })
    expect(await readCache('BTCUSDT', '4h', 400, 123)).toBeNull()
    expect(await rawGet(KEY)).toBeUndefined()
  })

  it('봉투의 파라미터가 요청과 다르면 폐기 — 키는 계약이 아니다', async () => {
    await rawPut(KEY, {
      version: CACHE_VERSION, symbol: 'ETHUSDT', tf: '4h', limit: 400, endTime: 123,
      candles: candles(10),
    })
    expect(await readCache('BTCUSDT', '4h', 400, 123)).toBeNull()
    expect(await rawGet(KEY)).toBeUndefined()
  })

  it('캔들 필드가 빠졌거나 문자열이면 폐기', async () => {
    const bad = candles(10) as unknown as Record<string, unknown>[]
    bad[3] = { ...bad[3], close: '100' }
    await rawPut(KEY, {
      version: CACHE_VERSION, symbol: 'BTCUSDT', tf: '4h', limit: 400, endTime: 123, candles: bad,
    })
    expect(await readCache('BTCUSDT', '4h', 400, 123)).toBeNull()
    expect(await rawGet(KEY)).toBeUndefined()
  })

  it('time 이 오름차순이 아니면 폐기', async () => {
    const bad = candles(10)
    bad[5] = { ...bad[5], time: bad[4].time }
    await rawPut(KEY, {
      version: CACHE_VERSION, symbol: 'BTCUSDT', tf: '4h', limit: 400, endTime: 123, candles: bad,
    })
    expect(await readCache('BTCUSDT', '4h', 400, 123)).toBeNull()
    expect(await rawGet(KEY)).toBeUndefined()
  })
})

describe('getCandles', () => {
  it('미스면 fetch 해서 저장하고, 두번째 호출은 네트워크를 치지 않는다', async () => {
    mockFetch.mockResolvedValue(candles(30))
    const first = await getCandles('BTCUSDT', '4h', 30, 123)
    const second = await getCandles('BTCUSDT', '4h', 30, 123)
    expect(first).toHaveLength(30)
    expect(second).toEqual(first)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('fetch 가 검증을 통과하지 못하면 던지고, 캐시에 남기지 않는다', async () => {
    mockFetch.mockResolvedValue([] as Candle[])
    await expect(getCandles('BTCUSDT', '4h', 30, 123)).rejects.toThrow('검증을 통과하지 못했다')
    expect(await rawGet(cacheKey('BTCUSDT', '4h', 123, 30))).toBeUndefined()
  })
})

describe('DB 스키마 업그레이드', () => {
  it('v1 의 죽은 스토어(questions/attempts)가 v2 연결 시 지워진다', async () => {
    // Part 2 시절 v1 DB 를 재현한다
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE)
        d.createObjectStore('questions', { keyPath: 'id' })
        d.createObjectStore('attempts', { keyPath: 'id' })
      },
    })
    v1.close()

    // 캐시 모듈이 v2 로 연결하면 업그레이드가 돈다
    await writeCache('BTCUSDT', '4h', 400, candles(5), 123)

    const v2 = await openDB(DB_NAME, 2)
    expect([...v2.objectStoreNames].sort()).toEqual([STORE])
    v2.close()
  })
})

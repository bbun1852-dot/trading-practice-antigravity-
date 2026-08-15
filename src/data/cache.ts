/**
 * 브라우저 캔들 캐시 (IndexedDB). 스크립트 전용 fileCache 의 브라우저 판이다.
 *
 * **fileCache 와 의미론이 같다 (Part 8 Task 3 에서 맞췄다):**
 * - 캐시는 최적화지 진실의 출처가 아니다 — 조금이라도 의심스러우면 폐기하고 다시 받는다
 * - readCache 는 어떤 경우에도 던지지 않는다. 모든 실패는 "미스" 로 격하된다
 * - 항목은 봉투(version + 요청 파라미터 + 페이로드)로 저장된다. **키는 계약이 아니다**
 *   — 무엇에 대한 캐시인지 항목 자신이 들고 있고, 읽을 때 대조한다
 * - 검증에 실패한 항목은 지운다 — 같은 실패를 매번 되풀이하지 않는다
 * - fetch 결과도 같은 검증을 통과해야 저장된다. 실패는 캐시 문제가 아니라 진짜
 *   오류이므로 던진다
 *
 * 페이로드 판정기는 validate.ts 로 fileCache 와 공유한다 — 두 캐시가 서로 다른
 * 데이터를 "정상" 이라 부르는 일이 구조적으로 없다.
 *
 * 호출부가 쓸 함수는 getCandles 하나다 (fileCache 와 같은 시그니처 — Task 4 의
 * 파이프라인 코드가 drill.ts 와 같은 모양이 된다). 나머지는 테스트용이다.
 */
import { openDB, type IDBPDatabase } from 'idb'
import type { Candle, Timeframe } from './types'
import { fetchKlines } from './binance'
import { isValidCandles } from './validate'

export const DB_NAME = 'chart-drill'
export const STORE = 'candles'

/**
 * IndexedDB 스키마 버전. v2: Part 2 시절 추측으로 만들어 두고 아무도 쓰지 않던
 * questions/attempts 스토어를 지웠다 (오답노트는 별개 DB 'ChartDrillNotebook' 를 쓴다).
 */
const DB_VERSION = 2

/**
 * 봉투 포맷 버전. Candle 의 모양이나 저장 방식이 바뀌면 반드시 올린다.
 * fileCache 의 CACHE_VERSION 과는 별개 카운터다 — 저장 형식이 독립적으로 진화한다.
 *
 * v1 이전(스파이크 시점)에는 Candle[] 를 알맹이째 저장했다. 그 항목들은 봉투가
 * 아니므로 "봉투 모양이 아님" 으로 폐기·재수신된다.
 */
export const CACHE_VERSION = 1

type CacheEnvelope = {
  version: number
  symbol: string
  tf: Timeframe
  limit: number
  /** 창의 끝(초). null 이면 "받은 시점의 최신" — 즉 매번 다른 데이터다. */
  endTime: number | null
  candles: Candle[]
}

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
        for (const dead of ['questions', 'attempts']) {
          if (d.objectStoreNames.contains(dead)) d.deleteObjectStore(dead)
        }
      },
    })
  }
  return dbPromise
}

/**
 * 테스트 전용 — fake-indexeddb 가 팩토리를 갈아끼울 때 모듈에 잡혀 있는
 * 이전 연결을 버린다. 프로덕션 코드는 부르지 않는다.
 */
export function resetDbConnectionForTests(): void {
  dbPromise = null
}

export function cacheKey(symbol: string, tf: Timeframe, endTime: number | null, limit: number): string {
  return `${symbol}|${tf}|${endTime ?? 'latest'}|${limit}`
}

/** 검증에 실패한 항목은 지운다. 지우기 실패도 미스일 뿐이다 — 최적화가 장애가 되면 안 된다. */
async function discard(key: string, reason: string): Promise<void> {
  console.warn(`[cache] 캐시 폐기 (${reason}): ${key}`)
  try {
    await (await db()).delete(STORE, key)
  } catch {
    // no-op
  }
}

/**
 * 캐시 항목을 읽는다. **절대 던지지 않는다.** 조금이라도 미심쩍으면 null 이고,
 * null 은 곧 "다시 받아라" 라는 뜻이다.
 */
export async function readCache(
  symbol: string, tf: Timeframe, limit: number, endTime?: number,
): Promise<Candle[] | null> {
  const key = cacheKey(symbol, tf, endTime ?? null, limit)

  let stored: unknown
  try {
    stored = await (await db()).get(STORE, key)
  } catch {
    // DB 를 못 열거나 읽기가 깨지면 없는 것과 같다
    return null
  }
  if (stored === undefined) return null

  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    // 봉투가 아니다 — 스파이크 시절 Candle[] 를 알맹이째 저장했던 항목이 여기 걸린다
    await discard(key, '봉투 모양이 아님')
    return null
  }

  const env = stored as Partial<CacheEnvelope>

  if (env.version !== CACHE_VERSION) {
    await discard(key, `포맷 버전 불일치 (항목 ${String(env.version)} ≠ 현재 ${CACHE_VERSION})`)
    return null
  }

  // 이 항목이 "무엇에 대한" 캐시인지 항목 자신에게 물어본다. 키는 계약이 아니다.
  if (
    env.symbol !== symbol || env.tf !== tf || env.limit !== limit ||
    env.endTime !== (endTime ?? null)
  ) {
    await discard(
      key,
      `요청 파라미터 불일치 (항목 ${String(env.symbol)}/${String(env.tf)}/` +
      `${String(env.limit)}/${String(env.endTime)})`,
    )
    return null
  }

  if (!isValidCandles(env.candles)) {
    await discard(key, '캔들 페이로드 검증 실패')
    return null
  }

  return env.candles
}

export async function writeCache(
  symbol: string, tf: Timeframe, limit: number, cs: Candle[], endTime?: number,
): Promise<void> {
  const env: CacheEnvelope = {
    version: CACHE_VERSION, symbol, tf, limit, endTime: endTime ?? null, candles: cs,
  }
  // IndexedDB 의 put 은 트랜잭션이라 fileCache 의 tmp+rename 에 해당하는 원자성을 그냥 얻는다
  await (await db()).put(STORE, env, cacheKey(symbol, tf, endTime ?? null, limit))
}

/**
 * 캐시 우선, 없으면 fetch 후 저장. **호출부가 쓰는 유일한 함수다.**
 *
 * endTime(초)을 주면 그 시점까지의 창을 고정해 받는다. 생략하면 "지금까지의 최신" —
 * 연습 문제 생성은 이쪽이 맞고(스펙 §3), 재현 가능한 측정은 endTime 을 고정해야 한다.
 */
export async function getCandles(
  symbol: string, tf: Timeframe, limit = 1000, endTime?: number,
): Promise<Candle[]> {
  const hit = await readCache(symbol, tf, limit, endTime)
  if (hit) return hit

  const cs = await fetchKlines(symbol, tf, { limit, endTime })
  // 캐시에 넣을 만큼 믿지 못하는 데이터는 계산에 쓸 만큼도 믿지 못한다.
  const n = cs.length
  if (!isValidCandles(cs)) {
    throw new Error(`${symbol} ${tf}: 받아온 캔들이 검증을 통과하지 못했다 (${n}개)`)
  }
  await writeCache(symbol, tf, limit, cs, endTime)
  return cs
}

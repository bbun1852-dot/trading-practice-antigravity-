import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Candle, Timeframe } from './types'
import { fetchKlines } from './binance'

/**
 * 스크립트 전용 캔들 캐시. Node 에만 존재하며 브라우저의 IndexedDB 캐시(cache.ts)와 별개다.
 * 임계값 조정은 같은 데이터로 수십 번 반복하므로 매번 네트워크를 치면 느리고 불안정하다.
 *
 * **설계 원칙: 캐시는 최적화지 진실의 출처가 아니다.**
 * 캐시 항목에 조금이라도 의심이 있으면 무조건 다시 받는다. readCache 는 어떤 경우에도
 * 예외를 던지지 않는다 — 못 읽든, 깨졌든, 버전이 다르든, 모양이 틀렸든 전부 "캐시 미스"로
 * 격하되고 fetch 로 이어진다. 이 캐시는 임계값 튜닝을 수십 번 반복하는 동안 재사용되고
 * Task 6~10 이 그 위에 임계값을 세운다 — 조용히 오염된 데이터가 통과하면 그 오염이
 * 이후 모든 임계값에 전파된다.
 *
 * 호출부가 쓸 함수는 getCandles 하나다. cachePath/readCache/writeCache 는 테스트가
 * 각 실패 모드를 직접 찌르기 위해 열어 둔 것이다.
 */

/**
 * 캐시 포맷 버전. Candle 의 모양이나 저장 방식이 바뀌면 반드시 올린다.
 * 파일 이름은 계약이 아니다 — 이름이 같아도 버전이 다르면 남이다.
 */
const CACHE_VERSION = 1

const DIR = join(process.cwd(), '.candle-cache')

/** 디스크에 실제로 저장되는 모양. 무엇에 대한 캐시인지를 항목 자신이 들고 있다. */
type CacheEnvelope = {
  version: number
  symbol: string
  tf: Timeframe
  limit: number
  candles: Candle[]
}

export function cachePath(symbol: string, tf: Timeframe, limit: number): string {
  // 심볼은 파일 이름의 일부가 되므로 경로 문자를 흘려보내지 않는다.
  const safe = symbol.replace(/[^A-Za-z0-9_]/g, '_')
  return join(DIR, `${safe}-${tf}-${limit}.json`)
}

const NUM_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const

function isCandle(v: unknown): v is Candle {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  // 여섯 필드가 전부 있고 전부 유한수여야 한다. NaN/Infinity/문자열은 전부 탈락 —
  // JSON.parse 는 "1.0" 같은 문자열도 군말 없이 통과시킨다.
  return NUM_FIELDS.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]))
}

/** 페이로드를 진짜로 검사한다. 1000개쯤 훑는 건 비용이 아니다. */
function isValidCandles(v: unknown): v is Candle[] {
  if (!Array.isArray(v) || v.length === 0) return false
  for (let i = 0; i < v.length; i++) {
    if (!isCandle(v[i])) return false
    // 모든 감지기가 시간 오름차순을 전제한다. 중복·역순은 조용히 통과시키면 안 된다.
    if (i > 0 && v[i].time <= v[i - 1].time) return false
  }
  return true
}

/** 검증에 실패한 파일은 지운다 — 같은 실패를 매 실행마다 되풀이하지 않기 위해서다. */
function discard(p: string, reason: string): void {
  console.warn(`[fileCache] 캐시 폐기 (${reason}): ${p}`)
  try {
    rmSync(p, { force: true })
  } catch {
    // 지우는 데 실패해도 캐시 미스일 뿐이다. 여기서 던지면 최적화가 장애가 된다.
  }
}

/**
 * 캐시 항목을 읽는다. **절대 예외를 던지지 않는다.** 조금이라도 미심쩍으면 null 이고,
 * null 은 곧 "다시 받아라" 라는 뜻이다.
 */
export function readCache(symbol: string, tf: Timeframe, limit: number): Candle[] | null {
  const p = cachePath(symbol, tf, limit)
  if (!existsSync(p)) return null

  let raw: string
  try {
    raw = readFileSync(p, 'utf8')
  } catch {
    // 권한, 경합 삭제, 디렉터리 등 — 읽을 수 없으면 없는 것과 같다. 지울 것도 없다.
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    discard(p, 'JSON 파싱 실패')
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    // 봉투가 아니다 — 옛 버전이 Candle[] 를 알맹이째 저장했던 파일이 여기 걸린다.
    discard(p, '봉투 모양이 아님')
    return null
  }

  const env = parsed as Partial<CacheEnvelope>

  if (env.version !== CACHE_VERSION) {
    discard(p, `포맷 버전 불일치 (파일 ${String(env.version)} ≠ 현재 ${CACHE_VERSION})`)
    return null
  }

  // 이 파일이 "무엇에 대한" 캐시인지 항목 자신에게 물어본다. 파일 이름은 계약이 아니다.
  if (env.symbol !== symbol || env.tf !== tf || env.limit !== limit) {
    discard(p, `요청 파라미터 불일치 (파일 ${String(env.symbol)}/${String(env.tf)}/${String(env.limit)})`)
    return null
  }

  if (!isValidCandles(env.candles)) {
    discard(p, '캔들 페이로드 검증 실패')
    return null
  }

  return env.candles
}

export function writeCache(symbol: string, tf: Timeframe, limit: number, cs: Candle[]): void {
  mkdirSync(DIR, { recursive: true })
  const p = cachePath(symbol, tf, limit)
  const env: CacheEnvelope = { version: CACHE_VERSION, symbol, tf, limit, candles: cs }

  // 임시 파일에 쓰고 rename 으로 갈아끼운다 — 쓰다가 죽어도 잘린 파일이 관측되지 않는다.
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(env), 'utf8')
  renameSync(tmp, p)
}

/**
 * 캐시 우선, 없으면 fetch 후 저장. **호출부가 쓰는 유일한 함수다.**
 */
export async function getCandles(symbol: string, tf: Timeframe, limit = 1000): Promise<Candle[]> {
  const hit = readCache(symbol, tf, limit)
  if (hit) return hit

  const cs = await fetchKlines(symbol, tf, { limit })
  // 캐시에 넣을 만큼 믿지 못하는 데이터는 계산에 쓸 만큼도 믿지 못한다.
  // 여긴 캐시 문제가 아니라 진짜 오류이므로 조용히 넘기지 않고 던진다.
  // (개수는 미리 담아 둔다 — 타입가드가 실패 분기에서 cs 를 never 로 좁힌다.)
  const n = cs.length
  if (!isValidCandles(cs)) {
    throw new Error(`${symbol} ${tf}: 받아온 캔들이 검증을 통과하지 못했다 (${n}개)`)
  }
  writeCache(symbol, tf, limit, cs)
  return cs
}

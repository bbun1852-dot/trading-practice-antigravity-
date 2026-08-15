/**
 * 캔들 페이로드 검증 — **fileCache(Node)와 cache(브라우저)가 공유하는 유일한 판정기.**
 *
 * 두 캐시가 서로 다른 검증을 갖는 순간 "스크립트에서는 통과한 데이터가 브라우저에서는
 * 다르다"(또는 그 반대)가 생긴다. 같은 함수를 쓰면 그 부류의 어긋남이 구조적으로 없다
 * — Task 3 게이트의 "파서 공유" 가 이것이다 (fetch 는 원래 binance.ts 하나였고,
 * 검증이 fileCache 사본으로만 있던 것을 여기로 올렸다).
 */
import type { Candle } from './types'

const NUM_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const

export function isCandle(v: unknown): v is Candle {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  // 여섯 필드가 전부 있고 전부 유한수여야 한다. NaN/Infinity/문자열은 전부 탈락 —
  // JSON.parse 는 "1.0" 같은 문자열도 군말 없이 통과시킨다.
  return NUM_FIELDS.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]))
}

/** 페이로드를 진짜로 검사한다. 1000개쯤 훑는 건 비용이 아니다. */
export function isValidCandles(v: unknown): v is Candle[] {
  if (!Array.isArray(v) || v.length === 0) return false
  for (let i = 0; i < v.length; i++) {
    if (!isCandle(v[i])) return false
    // 모든 감지기가 시간 오름차순을 전제한다. 중복·역순은 조용히 통과시키면 안 된다.
    if (i > 0 && v[i].time <= v[i - 1].time) return false
  }
  return true
}

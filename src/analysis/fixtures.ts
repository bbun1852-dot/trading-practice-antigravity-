import type { Candle } from '../data/types'

/** 시드 기반 결정론적 난수 (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 테스트용 합성 캔들. 같은 seed면 항상 같은 결과. */
export function synthCandles(n: number, seed = 42): Candle[] {
  const rand = rng(seed)
  const out: Candle[] = []
  let price = 100
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.48) * 2
    const open = price
    const close = Math.max(1, open + drift)
    const high = Math.max(open, close) + rand() * 1.5
    const low = Math.min(open, close) - rand() * 1.5
    out.push({
      time: 1600000000 + i * 14400,
      open, high, low, close,
      volume: 100 + rand() * 400,
    })
    price = close
  }
  return out
}

/** OHLC 4값으로 캔들 하나를 만드는 축약 헬퍼 */
export function mk(open: number, high: number, low: number, close: number, volume = 100, i = 0): Candle {
  return { time: 1600000000 + i * 14400, open, high, low, close, volume }
}

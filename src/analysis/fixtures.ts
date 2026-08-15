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

/**
 * 테스트용 합성 캔들. 같은 seed면 항상 같은 결과.
 *
 * open 은 직전 close 에서 시드 기반 지터로 띄운다 — 대부분은 작은 노이즈지만, 가끔은
 * (burst/gap 롤에 걸리면) 몸통이 크거나 갭이 실제로 남을 만큼 크게 띄운다. 이래야
 * 장악형 캔들과 3봉 FVG 가 픽스처에 실제로 등장한다 (직전 close 를 그대로 open 으로
 * 쓰면 갭이 원천적으로 생길 수 없다). 각 반복마다 rand() 를 정확히 같은 순서·횟수로
 * 호출하므로 접두 안정성(synthCandles(m, s) === synthCandles(n, s).slice(0, m))은 깨지지 않는다.
 */
export function synthCandles(n: number, seed = 42, interval = 14400): Candle[] {
  const rand = rng(seed)
  const out: Candle[] = []
  let price = 100
  for (let i = 0; i < n; i++) {
    // 가끔 몸통이 큰 캔들을 섞는다 — 장악형이 나오려면 필요하다.
    const burst = rand() < 0.2 ? 3.5 : 1
    const drift = (rand() - 0.48) * 2 * burst

    // 직전 close 에서 시가를 지터로 띄운다. 대부분은 작은 노이즈, 가끔은 갭이 남을 만큼 크게.
    const gapRoll = rand()
    const gapSpread = gapRoll < 0.25 ? 4 : 0.4
    const gapJitter = (rand() - 0.5) * gapSpread
    const open = Math.max(1, price + gapJitter)

    const close = Math.max(1, open + drift)
    const high = Math.max(open, close) + rand() * 1.5
    const low = Math.min(open, close) - rand() * 1.5
    out.push({
      time: 1600000000 + i * interval,
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

import type { Candle } from '../data/types'
import type { Detector, Signal } from './signalTypes'

function key(s: Signal): string {
  return `${s.id}@${s.barIndex}:${s.side}:${s.strength}:${s.evidence}`
}

/**
 * 불변식: 신호가 barIndex=k 에서 났다고 주장하면, k까지의 캔들만 줘도 같은 신호가 나와야 한다.
 *
 * 왜 "detect(전체).filter(<=i) === detect(0..i)" 가 아닌가:
 * FVG의 '미충족' 판정처럼 관측 시점까지의 상태에 의존하는 신호는, 나중에 갭이 메워지면
 * 전체 배열에서는 사라지는 게 정상이다. 그건 미래참조가 아니라 올바른 동작이다.
 * 반대로 여기서 잡아야 할 진짜 위반은 "k 시점에 알 수 없던 정보로 k에 신호를 낸 것"이다.
 */
export function assertNoLookAhead(
  detect: Detector,
  candles: Candle[],
  sampleEvery = 1,
): void {
  const full = detect(candles)
  const cache = new Map<number, Set<string>>()

  for (let n = 0; n < full.length; n += sampleEvery) {
    const s = full[n]
    if (s.barIndex < 0 || s.barIndex >= candles.length) {
      throw new Error(`barIndex ${s.barIndex} 가 캔들 범위(0..${candles.length - 1}) 밖이다: ${s.id}`)
    }
    if (!cache.has(s.barIndex)) {
      cache.set(s.barIndex, new Set(detect(candles.slice(0, s.barIndex + 1)).map(key)))
    }
    if (!cache.get(s.barIndex)!.has(key(s))) {
      throw new Error(
        `look-ahead 위반: 신호 "${key(s)}" 는 전체 배열에서는 나오지만\n` +
        `0..${s.barIndex} 까지만 주면 나오지 않는다. ` +
        `barIndex ${s.barIndex} 이후의 봉을 참조하고 있다.`,
      )
    }
  }
}

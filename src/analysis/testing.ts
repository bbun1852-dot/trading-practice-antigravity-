import type { Candle } from '../data/types'
import type { Detector, Signal } from './signalTypes'

/** refs 객체를 키 순서에 무관하게 안정적인 문자열로 직렬화한다. */
function stableRefs(refs: Signal['refs']): string {
  if (!refs) return ''
  const r = refs as Record<string, number | undefined>
  return Object.keys(r).sort().map((k) => `${k}=${r[k]}`).join(',')
}

/**
 * 신호의 동일성 키. barIndex 뿐 아니라 side/strength/tier/kind/confidence/refs/evidence
 * 전부를 포함한다 — 그래야 "barIndex 는 그대로 두고 tier/confidence/refs 만 미래 정보로
 * 뻥튀기"하는 공격을 놓치지 않는다.
 */
function key(s: Signal): string {
  return [s.id, s.barIndex, s.side, s.strength, s.tier, s.kind, s.confidence,
          stableRefs(s.refs), s.evidence].join('|')
}

/** 주어진 신호 목록에서 barIndex === bar 인 것들을, 키별 개수로 센다. */
function countsAtBar(signals: Signal[], bar: number): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of signals) {
    if (s.barIndex !== bar) continue
    const k = key(s)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

/**
 * 불변식: 신호가 barIndex=k 에서 났다고 주장하면, 0..k 까지의 캔들만 줘도
 * 적어도 같은 개수만큼 같은 신호가 나와야 한다.
 *
 * 왜 "actual === expected" 가 아니라 "actual >= expected" 인가:
 * FVG의 '미충족' 판정처럼 관측 시점까지의 상태에 의존하는 신호는, 나중에 갭이 메워지면
 * 전체 배열에서는 사라지는 게 정상이다 — 잘린 실행이 k 시점에는 신호를 냈지만 전체 실행에서는
 * 이후 봉이 그 갭을 메워 사라질 수 있다. 그건 미래참조가 아니라 올바른 동작이므로, 잘린 실행이
 * 전체 실행보다 "더 많이" 신호를 내는 것은 허용해야 한다. 반대로 여기서 잡아야 할 진짜 위반은
 * "k 시점까지의 정보만으로는 낼 수 없었던 신호를 전체 실행이 k에 냈다"는 것 — 즉 전체 실행의
 * 개수가 잘린 실행의 개수보다 많은 경우다.
 */
export function assertNoLookAhead(detect: Detector, candles: Candle[]): void {
  const full = detect(candles)

  if (full.length === 0) {
    throw new Error(
      'look-ahead 검증이 공허하다: 감지기가 이 픽스처에 대해 신호를 하나도 내지 않았다. ' +
      '통과가 아니라 실패다 — 픽스처가 이 감지기를 실제로 행사하지 못하고 있다.',
    )
  }

  for (const s of full) {
    if (!Number.isInteger(s.barIndex) || s.barIndex < 0 || s.barIndex >= candles.length) {
      throw new Error(
        `look-ahead 위반: barIndex ${s.barIndex} 가 정수 범위 0..${candles.length - 1} 를 ` +
        `벗어난다 (신호 id: ${s.id}).`,
      )
    }
  }

  const barIndices = new Set(full.map((s) => s.barIndex))
  const truncatedCache = new Map<number, Map<string, number>>()

  for (const k of barIndices) {
    const expected = countsAtBar(full, k)
    let actual = truncatedCache.get(k)
    if (!actual) {
      actual = countsAtBar(detect(candles.slice(0, k + 1)), k)
      truncatedCache.set(k, actual)
    }
    for (const [sigKey, expectedCount] of expected) {
      const actualCount = actual.get(sigKey) ?? 0
      if (actualCount < expectedCount) {
        throw new Error(
          `look-ahead 위반: 신호 "${sigKey}" 가 bar ${k} 에서 전체 실행은 ${expectedCount}개를 ` +
          `냈지만 0..${k} 까지만 잘라서 주면 ${actualCount}개만 난다. ` +
          `barIndex ${k} 이후의 봉을 참조하고 있다.`,
        )
      }
    }
  }
}

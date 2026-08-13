import { describe, it, expect } from 'vitest'
import { detectWyckoff } from './wyckoff'
import type { Candle } from '../data/types'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'

/** from → to 로 bars 개의 봉을 만든다. 꼬리는 ±0.3 고정 */
function leg(cs: Candle[], from: number, to: number, bars: number, volume = 100) {
  const step = (to - from) / bars
  let p = from
  for (let i = 0; i < bars; i++) {
    const open = p
    p += step
    cs.push(mk(open, Math.max(open, p) + 0.3, Math.min(open, p) - 0.3, p, volume, cs.length))
  }
}

/**
 * 축적 도식을 그대로 그린다: 하락 → SC → AR → ST → 침투 → SOS.
 *
 * 이 픽스처가 이 파트의 핵심 주장을 검증한다 — 와이코프 사건은 맥락 없이는 정의가
 * 성립하지 않으므로, 상태기계가 도식을 실제로 걸어가야 사건이 나온다.
 */
function pushAccumulation(cs: Candle[], b: number) {
  for (let k = 0; k < 3; k++) {          // 워밍업 — ATR 을 세운다
    leg(cs, b, b - 2, 4)
    leg(cs, b - 2, b, 4)
  }
  leg(cs, b, b - 12, 20)                                             // 선행 하락
  cs.push(mk(b - 12, b - 11.8, b - 16, b - 13, 400, cs.length))      // SC
  leg(cs, b - 13, b - 6, 10)                                         // 자동 랠리
  leg(cs, b - 6, b - 11, 6)                                          // 되돌림 → AR 확정
  leg(cs, b - 11, b - 15.4, 8)                                       // TR 하단 재방문 → ST
  cs.push(mk(b - 15.4, b - 15.2, b - 17.6, b - 14.8, 150, cs.length)) // 하단 침투 후 회복
  leg(cs, b - 14.8, b - 4, 10, 300)                                  // TR 상단 돌파 → SOS
}

/** 축적의 거울상. 상승 → BC → 자동 반락 → ST → 상단 침투 → SOW */
function pushDistribution(cs: Candle[], b: number) {
  for (let k = 0; k < 3; k++) {
    leg(cs, b, b + 2, 4)
    leg(cs, b + 2, b, 4)
  }
  leg(cs, b, b + 12, 20)
  cs.push(mk(b + 12, b + 16, b + 11.8, b + 13, 400, cs.length))
  leg(cs, b + 13, b + 6, 10)
  leg(cs, b + 6, b + 11, 6)
  leg(cs, b + 11, b + 15.4, 8)
  cs.push(mk(b + 15.4, b + 17.6, b + 15.2, b + 14.8, 150, cs.length))
  leg(cs, b + 14.8, b + 4, 10, 300)
}

function accumulationSchematic(): Candle[] {
  const cs: Candle[] = []
  pushAccumulation(cs, 120)
  return cs
}

/**
 * 도식을 여러 번 반복한다. synthCandles 는 추세가 없는 난수 보행이라 클라이맥스가
 * 한 번도 안 나므로(실측: 3000봉에서 0회) 상태기계를 전혀 행사하지 못한다.
 */
function repeatedSchematic(cycles: number): Candle[] {
  const cs: Candle[] = []
  for (let k = 0; k < cycles; k++) {
    pushAccumulation(cs, 120)
    pushDistribution(cs, 110)
  }
  return cs
}

describe('detectWyckoff', () => {
  it('빈 배열이면 빈 배열 반환', () => {
    expect(detectWyckoff([])).toEqual([])
  })

  it('룩어헤드 편향이 없어야 한다', () => {
    assertNoLookAhead(detectWyckoff, synthCandles(600))
  })

  it('축적 도식을 순서대로 걸어간다 — SC → AR → ST → 침투 → SOS', () => {
    const sigs = detectWyckoff(accumulationSchematic())
    const at = (id: string) => sigs.find((s) => s.id === id)?.barIndex

    const sc = at('wyckoff_climax')
    const ar = at('wyckoff_ar')
    const st = at('wyckoff_st')
    // ST 를 거친 침투는 기본형(스프링)이 아니라 진화형(쉐이크아웃)이다.
    const spring = at('wyckoff_shakeout')
    const sos = at('wyckoff_sos_sow')

    for (const [name, v] of [['SC', sc], ['AR', ar], ['ST', st], ['침투', spring], ['SOS', sos]] as const) {
      expect(v, `${name} 가 나오지 않았다`).toBeDefined()
    }
    expect(sc!).toBeLessThan(ar!)
    expect(ar!).toBeLessThan(st!)
    expect(st!).toBeLessThan(spring!)
    expect(spring!).toBeLessThan(sos!)
  })

  it('AR 은 클라이맥스 없이 나지 않는다 — 맥락이 정의의 일부다', () => {
    const sigs = detectWyckoff(repeatedSchematic(4))
    const climaxBars = sigs.filter((s) => s.id === 'wyckoff_climax').map((s) => s.barIndex)
    expect(climaxBars.length).toBeGreaterThan(0)

    for (const ar of sigs.filter((s) => s.id === 'wyckoff_ar')) {
      expect(climaxBars.some((b) => b < ar.barIndex)).toBe(true)
    }
  })

  it('축적과 분배가 거울상으로 동작한다', () => {
    const sigs = detectWyckoff(repeatedSchematic(3))
    const sides = (id: string) => new Set(sigs.filter((s) => s.id === id).map((s) => s.side))

    expect(sides('wyckoff_climax')).toEqual(new Set(['bullish', 'bearish']))
    expect(sides('wyckoff_sos_sow')).toEqual(new Set(['bullish', 'bearish']))
    // 진화형은 방향마다 다른 태그다 — 축적이면 쉐이크아웃, 분배면 UTAD.
    expect(sides('wyckoff_shakeout')).toEqual(new Set(['bullish']))
    expect(sides('wyckoff_utad')).toEqual(new Set(['bearish']))
  })

  /**
   * 국면을 전진시키지 않는 사건(Test·BU·LPS)은 조건이 참인 동안 매 봉 다시 날 수
   * 있다 — 이 프로젝트가 파트마다 걸린 함정이다. 에피소드당 한 번으로 막았는지
   * 본다: 같은 태그가 연달아(TR_MAX_BARS 안에) 반복되면 억제가 새는 것이다.
   */
  it('같은 사건을 한 에피소드에서 두 번 내지 않는다', () => {
    const sigs = detectWyckoff(repeatedSchematic(4))
    const lastBar = new Map<string, number>()
    for (const s of sigs) {
      const prev = lastBar.get(s.id)
      if (prev !== undefined) expect(s.barIndex - prev).toBeGreaterThan(1)
      lastBar.set(s.id, s.barIndex)
    }
  })

  it('결정론 — 같은 입력이면 같은 출력', () => {
    const cs = synthCandles(800)
    expect(detectWyckoff(cs)).toEqual(detectWyckoff(cs))
  })
})

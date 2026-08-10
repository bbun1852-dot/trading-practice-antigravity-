import { describe, it, expect } from 'vitest'
import { detectFibonacci, MIN_LEG_ATR } from './fibonacci'
import { assertNoLookAhead } from './testing'
import { mk, synthCandles } from './fixtures'
import type { Candle } from '../data/types'

/**
 * 손으로 만든 레그. 워밍업 20봉으로 ATR 을 안정시킨 뒤 저점 90 → 고점 110 의
 * 상승 레그를 만들고, 되돌림 구간에서 각 레벨을 지나가게 한다.
 *
 * findPivots(cs, 2) 는 피벗 양옆에 2봉을 요구하므로 고점·저점 주변에 여유를 둔다.
 */
function upLegFixture(): Candle[] {
  const cs: Candle[] = []
  // ATR ≈ 4 를 만드는 워밍업
  for (let i = 0; i < 20; i++) cs.push(mk(100, 102, 98, 100, 100, i))
  // 저점 90 (앞뒤 2봉 확보)
  cs.push(mk(97, 98, 95, 96, 100, 20))
  cs.push(mk(96, 97, 93, 94, 100, 21))
  cs.push(mk(94, 95, 90, 91, 100, 22))   // 스윙 로우 90
  cs.push(mk(91, 95, 91, 94, 100, 23))
  cs.push(mk(94, 99, 93, 98, 100, 24))
  // 고점 110 으로 상승 (앞뒤 2봉 확보)
  cs.push(mk(98, 104, 97, 103, 100, 25))
  cs.push(mk(103, 108, 102, 107, 100, 26))
  cs.push(mk(107, 110, 106, 109, 100, 27))  // 스윙 하이 110
  // findPivots 는 엄격 부등호다 — 뒤 봉의 고점이 110 과 같으면 피벗이 성립하지 않는다
  cs.push(mk(108, 108.5, 105, 106, 100, 28))
  cs.push(mk(106, 107, 103, 104, 100, 29))
  return cs
}

describe('detectFibonacci — 미래참조', () => {
  it('assertNoLookAhead 를 통과한다 (공허하지 않게)', () => {
    expect(() => assertNoLookAhead(detectFibonacci, synthCandles(600))).not.toThrow()
  })

  it('레그를 확정 피벗으로만 정한다 — 이후 봉을 바꿔도 결과가 같다', () => {
    // 이 검사가 이 감지기의 존재 이유다. "전체에서 가장 큰 스윙" 으로 레그를 고르면
    // 여기서 깨진다.
    const cs = synthCandles(400)
    // 피보는 레그가 성립하고 레벨을 지나갈 때만 나므로 봉을 고정하면 표본이 빌 수 있다.
    // 신호가 실제로 있는 봉 중 뒤쪽 여유가 남는 것을 고른다.
    const all = detectFibonacci(cs)
    const at = all.map((s) => s.barIndex).find((b) => b >= 200 && b < 350)
    expect(at, '검사에 쓸 신호가 없다').toBeDefined()
    const before = all.filter((s) => s.barIndex === at)
    expect(before.length, '표본이 0이면 검사가 공허하다').toBeGreaterThan(0)

    const tampered = [...cs]
    for (let i = at! + 1; i < tampered.length; i++) tampered[i] = mk(500, 900, 100, 800, 999, i)
    expect(detectFibonacci(tampered).filter((s) => s.barIndex === at)).toEqual(before)
  })
})

describe('detectFibonacci — 되돌림', () => {
  const base = upLegFixture()

  /** 레그 확정 후 지정한 가격을 지나가는 봉 하나를 덧붙인다 */
  const withTouch = (price: number): Candle[] =>
    [...base, mk(price + 1, price + 1.5, price - 1.5, price, 100, base.length)]

  // 레그 90→110, range 20. 되돌림: 38.2% = 102.36, 50% = 100, 61.8% = 97.64
  it('38.2% 되돌림을 지나면 낸다', () => {
    const cs = withTouch(102.36)
    const ids = detectFibonacci(cs).filter((s) => s.barIndex === cs.length - 1).map((s) => s.id)
    expect(ids).toContain('fib_retrace_382')
  })

  it('61.8% 되돌림을 지나면 낸다 — 골든 포켓이라 strength 3', () => {
    const cs = withTouch(97.64)
    const sig = detectFibonacci(cs).find((s) => s.barIndex === cs.length - 1 && s.id === 'fib_retrace_618')
    expect(sig).toBeDefined()
    expect(sig!.strength).toBe(3)
  })

  it('상승 레그의 되돌림은 지지 후보라 bullish 다', () => {
    const cs = withTouch(100)
    const sig = detectFibonacci(cs).find((s) => s.barIndex === cs.length - 1 && s.id === 'fib_retrace_5')
    expect(sig!.side).toBe('bullish')
  })

  it('레벨에서 벗어난 봉에서는 내지 않는다', () => {
    const cs = withTouch(85)   // 어떤 되돌림 레벨과도 겹치지 않는다
    const ids = detectFibonacci(cs).filter((s) => s.barIndex === cs.length - 1).map((s) => s.id)
    expect(ids.filter((id) => id.startsWith('fib_retrace_'))).toEqual([])
  })

  it('레그가 ATR 대비 너무 작으면 아무것도 내지 않는다', () => {
    // 전 구간을 좁게 눌러 레그를 MIN_LEG_ATR 미만으로 만든다
    const flat: Candle[] = []
    for (let i = 0; i < 40; i++) flat.push(mk(100, 102, 98, 100, 100, i))
    flat.push(mk(100, 100.4, 99.6, 100, 100, 40))
    expect(detectFibonacci(flat)).toEqual([])
    expect(MIN_LEG_ATR).toBeGreaterThan(0)
  })
})

describe('detectFibonacci — 확장', () => {
  it('161.8% 확장 목표에 닿으면 낸다', () => {
    // 레그 90→110, range 20 → 확장 = 90 + 1.618×20 = 122.36
    const base = upLegFixture()
    const cs = [...base, mk(120, 123, 119, 122, 100, base.length)]
    const sig = detectFibonacci(cs).find((s) => s.barIndex === cs.length - 1 && s.id === 'fib_extension')
    expect(sig).toBeDefined()
    expect(sig!.side).toBe('bullish')   // 목표 도달은 레그 방향과 같은 편
  })
})

describe('detectFibonacci — 중첩', () => {
  const sigs = detectFibonacci(synthCandles(600))

  it('중첩이 실제로 나온다', () => {
    expect(sigs.some((s) => s.id === 'fib_confluence'), 'fib_confluence 가 한 번도 안 나온다').toBe(true)
  })

  it('중첩은 같은 봉의 되돌림 신호를 동반한다', () => {
    // 중첩은 되돌림 레벨을 지나갈 때만 나므로 짝이 없으면 로직이 어긋난 것이다
    for (const s of sigs.filter((x) => x.id === 'fib_confluence')) {
      const sameBar = sigs.filter((x) => x.barIndex === s.barIndex && x.id.startsWith('fib_retrace_'))
      expect(sameBar.length, `bar ${s.barIndex} 에 되돌림 없이 중첩만 있다`).toBeGreaterThan(0)
    }
  })

  it('겹친 상대를 문구에 적지 않는다 — 잘린 실행과 갈리면 미래참조로 잡힌다', () => {
    for (const s of sigs.filter((x) => x.id === 'fib_confluence')) {
      expect(s.evidence).toContain('오더블록/FVG 구간과 중첩')
    }
  })
})

describe('detectFibonacci — 출력 계약', () => {
  const sigs = detectFibonacci(synthCandles(600))

  it('한 봉에서 같은 id 가 두 번 나오지 않는다', () => {
    const seen = new Set<string>()
    for (const s of sigs) {
      const k = `${s.barIndex}|${s.id}`
      expect(seen.has(k), `중복 배출: ${k}`).toBe(false)
      seen.add(k)
    }
  })

  it('되돌림 3종이 모두 실제로 나온다', () => {
    const ids = new Set(sigs.map((s) => s.id))
    for (const id of ['fib_retrace_382', 'fib_retrace_5', 'fib_retrace_618']) {
      expect(ids.has(id), `${id} 가 픽스처에서 한 번도 안 나온다`).toBe(true)
    }
  })

  it('refs 에 레벨 가격과 레그 구간을 채운다', () => {
    expect(sigs.length).toBeGreaterThan(0)
    for (const s of sigs) {
      expect(s.refs?.price).toBeTypeOf('number')
      expect(s.refs!.fromBar!).toBeLessThan(s.refs!.toBar!)
    }
  })
})

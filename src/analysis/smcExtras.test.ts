import { describe, it, expect } from 'vitest'
import { detectSmcExtras } from './smcExtras'
import { assertNoLookAhead } from './testing'
import { mk, synthCandles } from './fixtures'

const cs = synthCandles(800)
const sigs = detectSmcExtras(cs)
const ids = new Set(sigs.map((s) => s.id))

describe('detectSmcExtras — 미래참조', () => {
  it('assertNoLookAhead 를 통과한다 (공허하지 않게)', () => {
    expect(() => assertNoLookAhead(detectSmcExtras, synthCandles(600))).not.toThrow()
  })

  it('결정 시점 이후 봉을 바꿔도 그 시점의 신호가 그대로다', () => {
    const base = synthCandles(400)
    const all = detectSmcExtras(base)
    const at = all.map((s) => s.barIndex).find((b) => b >= 200 && b < 350)
    expect(at, '검사에 쓸 신호가 없다').toBeDefined()
    const before = all.filter((s) => s.barIndex === at)

    const tampered = [...base]
    for (let i = at! + 1; i < tampered.length; i++) tampered[i] = mk(500, 900, 100, 800, 9999, i)
    expect(detectSmcExtras(tampered).filter((s) => s.barIndex === at)).toEqual(before)
  })
})

describe('detectSmcExtras — 3종이 실제로 발화한다', () => {
  for (const id of ['ob_double_engulfing', 'liq_pool_untapped', 'fvg_rebalance']) {
    it(`${id} 가 나온다`, () => {
      expect(ids.has(id), `${id} 가 픽스처에서 한 번도 안 나온다`).toBe(true)
    })
  }
})

describe('detectSmcExtras — 출력 계약', () => {
  it('한 봉에서 같은 id 가 두 번 나오지 않는다', () => {
    const seen = new Set<string>()
    for (const s of sigs) {
      const k = `${s.barIndex}|${s.id}`
      expect(seen.has(k), `중복 배출: ${k}`).toBe(false)
      seen.add(k)
    }
  })

  it('barIndex 오름차순으로 낸다', () => {
    const bars = sigs.map((s) => s.barIndex)
    expect(bars).toEqual([...bars].sort((a, b) => a - b))
  })

  it('fvg_rebalance 는 구간을 refs 에 채운다 — 수명이 zone(touch) 라 필요하다', () => {
    const reb = sigs.filter((s) => s.id === 'fvg_rebalance')
    expect(reb.length).toBeGreaterThan(0)
    for (const s of reb) {
      expect(s.refs?.priceLow).toBeTypeOf('number')
      expect(s.refs?.priceHigh).toBeTypeOf('number')
      expect(s.refs!.priceHigh!).toBeGreaterThan(s.refs!.priceLow!)
    }
  })

  it('fvg_rebalance 는 갭 하나당 한 번만 낸다', () => {
    const byGap = new Map<number, number>()
    for (const s of sigs.filter((x) => x.id === 'fvg_rebalance')) {
      const g = s.refs!.fromBar!
      byGap.set(g, (byGap.get(g) ?? 0) + 1)
    }
    for (const [gap, n] of byGap) expect(n, `갭 ${gap} 에서 ${n}회 발화`).toBe(1)
  })

  it('liq_pool_untapped 는 유동성이 쌓인 쪽을 가리킨다', () => {
    const pools = sigs.filter((s) => s.id === 'liq_pool_untapped')
    expect(pools.length).toBeGreaterThan(0)
    // 등고점이면 위로(bullish), 등저점이면 아래로(bearish)
    expect(pools.every((s) =>
      (s.evidence.includes('등고점') && s.side === 'bullish') ||
      (s.evidence.includes('등저점') && s.side === 'bearish'))).toBe(true)
  })

  it('evidence 에 이상값이 없다', () => {
    expect(sigs.every((s) => !s.evidence.includes('NaN') && !s.evidence.includes('Infinity'))).toBe(true)
  })
})

describe('detectSmcExtras — 경계', () => {
  for (const [name, c] of [
    ['빈 배열', []],
    ['1봉', [mk(100, 101, 99, 100, 100, 0)]],
    ['평봉 300개', Array.from({ length: 300 }, (_, i) => mk(100, 100, 100, 100, 100, i))],
  ] as const) {
    it(`${name} 에서 예외도 이상값도 없다`, () => {
      const got = detectSmcExtras([...c])
      expect(got.every((s) => !s.evidence.includes('NaN'))).toBe(true)
    })
  }
})

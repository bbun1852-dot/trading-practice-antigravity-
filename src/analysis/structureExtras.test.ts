import { describe, it, expect } from 'vitest'
import { detectStructureExtras, RETEST_WINDOW } from './structureExtras'
import { assertNoLookAhead } from './testing'
import { mk, synthCandles } from './fixtures'

const cs = synthCandles(800)
const sigs = detectStructureExtras(cs)
const ids = new Set(sigs.map((s) => s.id))

describe('detectStructureExtras — 미래참조', () => {
  it('assertNoLookAhead 를 통과한다 (공허하지 않게)', () => {
    expect(() => assertNoLookAhead(detectStructureExtras, synthCandles(600))).not.toThrow()
  })

  /**
   * 이 검사가 이 파일의 존재 이유다. srLevels(cs) 를 그대로 쓰면 레벨의 가격과
   * touches 가 미래 피벗까지 포함해 계산되어, 이미 지나간 봉의 evidence 가 바뀐다.
   */
  it('S/R 군집을 확정 피벗만으로 쌓는다 — 이후 봉을 바꿔도 결과가 같다', () => {
    const base = synthCandles(400)
    const all = detectStructureExtras(base)
    const at = all.map((s) => s.barIndex).find((b) => b >= 200 && b < 350)
    expect(at, '검사에 쓸 신호가 없다').toBeDefined()
    const before = all.filter((s) => s.barIndex === at)

    const tampered = [...base]
    for (let i = at! + 1; i < tampered.length; i++) tampered[i] = mk(500, 900, 100, 800, 9999, i)
    expect(detectStructureExtras(tampered).filter((s) => s.barIndex === at)).toEqual(before)
  })
})

describe('detectStructureExtras — 4종이 실제로 발화한다', () => {
  for (const id of ['sr_flip', 'retest_success', 'retest_fail']) {
    it(`${id} 가 나온다`, () => {
      expect(ids.has(id), `${id} 가 픽스처에서 한 번도 안 나온다`).toBe(true)
    })
  }
})


describe('retest — 성공과 실패가 갈린다', () => {
  it('한 붕괴당 리테스트는 한 번이다', () => {
    const retests = sigs.filter((s) => s.id.startsWith('retest_'))
    const seen = new Set<number>()
    for (const s of retests) {
      const from = s.refs!.fromBar!
      expect(seen.has(from), `붕괴 ${from} 에서 리테스트 재발화`).toBe(false)
      seen.add(from)
    }
  })

  it('리테스트는 붕괴 이후 RETEST_WINDOW 안에서만 난다', () => {
    for (const s of sigs.filter((x) => x.id.startsWith('retest_'))) {
      const gap = s.barIndex - s.refs!.fromBar!
      expect(gap).toBeGreaterThan(0)
      expect(gap).toBeLessThanOrEqual(RETEST_WINDOW)
    }
  })

  it('성공과 실패가 둘 다 나온다 — 한쪽만 나오면 판정이 한쪽으로 굳은 것이다', () => {
    expect(ids.has('retest_success')).toBe(true)
    expect(ids.has('retest_fail')).toBe(true)
  })
})

describe('detectStructureExtras — 출력 계약', () => {
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

  it('evidence 에 이상값이 없다', () => {
    expect(sigs.every((s) => !s.evidence.includes('NaN') && !s.evidence.includes('Infinity'))).toBe(true)
  })
})

describe('detectStructureExtras — 경계', () => {
  for (const [name, c] of [
    ['빈 배열', []],
    ['1봉', [mk(100, 101, 99, 100, 100, 0)]],
    ['평봉 300개', Array.from({ length: 300 }, (_, i) => mk(100, 100, 100, 100, 100, i))],
  ] as const) {
    it(`${name} 에서 예외도 이상값도 없다`, () => {
      expect(() => detectStructureExtras([...c])).not.toThrow()
    })
  }
})

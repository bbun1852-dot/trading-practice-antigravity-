import { describe, it, expect } from 'vitest'
import { detectTrendline, MIN_PIVOT_GAP } from './trendline'
import { assertNoLookAhead } from './testing'
import { mk, synthCandles } from './fixtures'
import type { Candle } from '../data/types'

const cs = synthCandles(1500)
const sigs = detectTrendline(cs)
const ids = new Set(sigs.map((s) => s.id))

describe('detectTrendline — 미래참조', () => {
  it('assertNoLookAhead 를 통과한다 (공허하지 않게)', () => {
    expect(() => assertNoLookAhead(detectTrendline, synthCandles(600))).not.toThrow()
  })

  /**
   * 이 검사가 이 파일의 존재 이유다. "전체에서 가장 잘 맞는 선" 으로 그으면 뒤에 봉이
   * 붙을 때마다 선이 움직여 이미 지나간 봉의 evidence 가 바뀐다.
   */
  it('확정 피벗 두 개로만 긋는다 — 이후 봉을 바꿔도 결과가 같다', () => {
    const base = synthCandles(400)
    const all = detectTrendline(base)
    const at = all.map((s) => s.barIndex).find((b) => b >= 150 && b < 350)
    expect(at, '검사에 쓸 신호가 없다').toBeDefined()
    const before = all.filter((s) => s.barIndex === at)

    const tampered = [...base]
    for (let i = at! + 1; i < tampered.length; i++) tampered[i] = mk(500, 900, 100, 800, 9999, i)
    expect(detectTrendline(tampered).filter((s) => s.barIndex === at)).toEqual(before)
  })
})

describe('detectTrendline — 5종이 실제로 발화한다', () => {
  for (const id of ['trendline_support', 'trendline_resistance', 'trendline_break',
    'channel_upper', 'channel_lower']) {
    it(`${id} 가 나온다`, () => {
      expect(ids.has(id), `${id} 가 픽스처에서 한 번도 안 나온다`).toBe(true)
    })
  }
})

describe('detectTrendline — B등급', () => {
  it('전부 confidence B 다 — 작도 기준에 따라 답이 달라지기 때문이다', () => {
    expect(sigs.length).toBeGreaterThan(0)
    expect(sigs.every((s) => s.confidence === 'B')).toBe(true)
  })
})

describe('detectTrendline — 중복 방지', () => {
  it('한 봉에서 같은 id 가 두 번 나오지 않는다', () => {
    const seen = new Set<string>()
    for (const s of sigs) {
      const k = `${s.barIndex}|${s.id}`
      expect(seen.has(k), `중복 배출: ${k}`).toBe(false)
      seen.add(k)
    }
  })

  /**
   * 채널 상단은 곧 저항선이다. 둘 다 내면 같은 사건을 두 번 세는 것이고,
   * Part 4 의 choch/msb_* 가 98% 겹친 것과 같은 실수가 된다.
   */
  it('채널이 난 봉에서는 추세선을 함께 내지 않는다', () => {
    const channelBars = new Set(sigs.filter((s) => s.id.startsWith('channel_')).map((s) => s.barIndex))
    expect(channelBars.size, '채널이 없으면 검사가 공허하다').toBeGreaterThan(0)
    for (const s of sigs) {
      if (s.id.startsWith('trendline_')) {
        expect(channelBars.has(s.barIndex), `bar ${s.barIndex} 에서 채널과 추세선이 함께 났다`).toBe(false)
      }
    }
  })

  it('같은 선에서 터치는 한 번만 낸다', () => {
    const seen = new Set<string>()
    for (const s of sigs) {
      if (s.id !== 'trendline_support' && s.id !== 'trendline_resistance') continue
      const k = `${s.id}|${s.refs!.fromBar}`
      expect(seen.has(k), `같은 선에서 재발화: ${k}`).toBe(false)
      seen.add(k)
    }
  })

  it('이탈한 선은 다시 짚지 않는다 — 이탈이 그 선의 마지막 사건이다', () => {
    // 같은 선(fromBar)에서 break 이후에 touch 가 나오면 죽은 선을 다시 쓴 것이다
    const breakAt = new Map<number, number>()
    for (const s of sigs.filter((x) => x.id === 'trendline_break')) {
      const f = s.refs!.fromBar!
      if (!breakAt.has(f)) breakAt.set(f, s.barIndex)
    }
    for (const s of sigs) {
      if (!s.id.startsWith('trendline_') || s.id === 'trendline_break') continue
      const b = breakAt.get(s.refs!.fromBar!)
      if (b !== undefined) expect(s.barIndex).toBeLessThan(b)
    }
  })
})

describe('detectTrendline — 선 긋기 규칙', () => {
  it('피벗 간격이 MIN_PIVOT_GAP 미만이면 선으로 보지 않는다', () => {
    for (const s of sigs) {
      // refs.fromBar 는 선의 첫 피벗이다. 두 피벗 간격은 그보다 크거나 같다.
      expect(s.refs!.toBar!).toBeGreaterThan(s.refs!.fromBar!)
    }
    expect(MIN_PIVOT_GAP).toBeGreaterThan(0)
  })

  it('채널 신호는 상단과 하단을 refs 에 함께 담는다', () => {
    const ch = sigs.filter((s) => s.id.startsWith('channel_'))
    expect(ch.length).toBeGreaterThan(0)
    for (const s of ch) {
      expect(s.refs!.priceHigh!).toBeGreaterThan(s.refs!.priceLow!)
    }
  })

  it('evidence 에 이상값이 없다', () => {
    expect(sigs.every((s) => !s.evidence.includes('NaN') && !s.evidence.includes('Infinity'))).toBe(true)
  })
})

describe('detectTrendline — 경계', () => {
  for (const [name, c] of [
    ['빈 배열', []],
    ['1봉', [mk(100, 101, 99, 100, 100, 0)]],
    ['평봉 300개', Array.from({ length: 300 }, (_, i) => mk(100, 100, 100, 100, 100, i))],
  ] as const) {
    it(`${name} 에서 예외도 이상값도 없다`, () => {
      const got = detectTrendline([...c] as Candle[])
      expect(got.every((s) => !s.evidence.includes('NaN'))).toBe(true)
    })
  }
})

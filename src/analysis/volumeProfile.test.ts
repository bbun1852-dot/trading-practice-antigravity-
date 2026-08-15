import { describe, it, expect } from 'vitest'
import { detectVolumeNodes, LOOKBACK } from './volumeProfile'
import { assertNoLookAhead } from './testing'
import { mk, synthCandles } from './fixtures'
import type { Candle } from '../data/types'

/**
 * 손으로 만든 프로파일. 앞쪽 110봉이 100 근처에 거래량을 몰아 매물대를 만들고,
 * 뒤쪽 9봉이 130까지 얇게 올라가 공백을 만든다. 마지막 봉이 전 구간을 덮어
 * 두 노드를 모두 건드린다.
 */
function base118(): Candle[] {
  const cs: Candle[] = []
  for (let i = 0; i < 110; i++) cs.push(mk(100, 100.5, 99.5, 100, 1000, i))
  for (let i = 0; i < 8; i++) {
    const p = 102 + i * 3
    cs.push(mk(p, p + 1.5, p - 1.5, p, 10, 110 + i))
  }
  return cs   // 0..117
}

/**
 * 발화는 **진입**일 때만 한다 — 직전 봉이 이미 그 구간에 걸쳐 있으면 체류지 진입이
 * 아니다. 그래서 두 노드를 한 봉으로 같이 검사할 수 없다. 시나리오를 나눈다.
 */
/** 118 은 위쪽에 머물고 119 가 아래 매물대로 내려온다 */
function enterHvn(): Candle[] {
  const cs = base118()
  cs.push(mk(124, 125, 123, 124, 10, 118))    // 매물대에 안 닿는다
  cs.push(mk(120, 125, 99, 100, 10, 119))     // 내려와서 매물대 진입
  return cs
}

/** 118 은 매물대 안에 있고 119 가 위쪽 공백으로 올라간다 */
function enterLvn(): Candle[] {
  const cs = base118()
  cs.push(mk(100, 100.4, 99.5, 100, 10, 118)) // 매물대 안 (공백에는 안 닿는다)
  cs.push(mk(100, 118, 99.5, 117, 10, 119))   // 위쪽 공백으로 진입
  return cs
}

describe('detectVolumeNodes — 미래참조', () => {
  it('assertNoLookAhead 를 통과한다 (공허하지 않게)', () => {
    // 하네스는 신호가 0개면 통과가 아니라 에러를 던진다 — 픽스처가 감지기를
    // 실제로 행사하는지까지 이 한 줄이 보증한다.
    expect(() => assertNoLookAhead(detectVolumeNodes, synthCandles(600))).not.toThrow()
  })

  it('결정 시점 이후 봉을 바꿔도 그 시점의 신호가 그대로다', () => {
    const cs = synthCandles(400)
    // 진입 순간에만 나므로 봉을 고정하면 표본이 빌 수 있다. 신호가 실제로 있는 봉을 고른다.
    const all = detectVolumeNodes(cs)
    const at = all.map((s) => s.barIndex).find((b) => b >= 200 && b < 350)
    expect(at, '검사에 쓸 신호가 없다').toBeDefined()
    const before = all.filter((s) => s.barIndex === at)
    expect(before.length, '표본이 0이면 검사가 공허하다').toBeGreaterThan(0)

    const tampered = [...cs]
    for (let i = at! + 1; i < tampered.length; i++) tampered[i] = mk(9999, 99999, 1, 5000, 999999, i)
    expect(detectVolumeNodes(tampered).filter((s) => s.barIndex === at)).toEqual(before)
  })

  it('창이 LOOKBACK 봉에 못 미치면 발화하지 않는다', () => {
    expect(detectVolumeNodes(synthCandles(LOOKBACK - 1))).toEqual([])
  })
})

describe('detectVolumeNodes — 노드 판정', () => {
  const at119 = (cs: Candle[]) => detectVolumeNodes(cs).filter((s) => s.barIndex === 119)
  const hvn = at119(enterHvn()).find((s) => s.id === 'volume_node_high')
  const lvn = at119(enterLvn()).find((s) => s.id === 'volume_node_low')

  it('거래량이 몰린 가격대에 진입하면 매물대를 낸다', () => {
    expect(hvn, '매물대가 감지되지 않았다').toBeDefined()
    // 앞쪽 110봉이 몰려 있던 100 근처를 덮어야 한다
    expect(hvn!.refs!.priceLow!).toBeLessThanOrEqual(100)
    expect(hvn!.refs!.priceHigh!).toBeGreaterThanOrEqual(100)
  })

  it('거래량이 희박한 가격대에 진입하면 공백을 낸다', () => {
    expect(lvn, '공백이 감지되지 않았다').toBeDefined()
    // 얇게 올라간 구간이므로 매물대보다 위에 있어야 한다
    expect(lvn!.refs!.priceLow!).toBeGreaterThan(100)
  })

  it('매물대의 배수가 공백의 배수보다 크다', () => {
    const ratioOf = (s: { evidence: string }) => Number(s.evidence.match(/([\d.]+)배/)![1])
    expect(ratioOf(hvn!)).toBeGreaterThan(ratioOf(lvn!))
  })

  it('직전 봉이 이미 그 구간에 있었으면 내지 않는다 — 체류는 진입이 아니다', () => {
    // enterHvn 의 118 을 119 와 같은 자리로 옮기면 진입이 아니게 된다
    const staying = enterHvn()
    staying[118] = mk(100, 125, 99, 100, 10, 118)
    const ids = at119(staying).map((s) => s.id)
    expect(ids).not.toContain('volume_node_high')
  })

  it('현재 봉이 구간에 닿지 않으면 내지 않는다', () => {
    const away = enterHvn()
    away[119] = mk(124, 125, 123.5, 124, 10, 119)
    expect(at119(away).map((s) => s.id)).not.toContain('volume_node_high')
  })
})

describe('detectVolumeNodes — 출력 계약', () => {
  const sigs = detectVolumeNodes(synthCandles(600))

  it('side 는 전부 중립이다 — 매물대는 방향을 단정할 수 없다', () => {
    expect(sigs.every((s) => s.side === 'neutral')).toBe(true)
  })

  it('한 봉에서 같은 id 가 두 번 나오지 않는다', () => {
    const seen = new Set<string>()
    for (const s of sigs) {
      const k = `${s.barIndex}|${s.id}`
      expect(seen.has(k), `중복 배출: ${k}`).toBe(false)
      seen.add(k)
    }
  })

  it('가격 구간을 refs 에 채운다 — 수명이 zone 이라 필요하다', () => {
    expect(sigs.length).toBeGreaterThan(0)
    for (const s of sigs) {
      expect(s.refs?.priceLow).toBeTypeOf('number')
      expect(s.refs?.priceHigh).toBeTypeOf('number')
      expect(s.refs!.priceHigh!).toBeGreaterThan(s.refs!.priceLow!)
    }
  })

  it('두 종류가 모두 실제로 나온다', () => {
    const ids = new Set(sigs.map((s) => s.id))
    expect(ids.has('volume_node_high'), '매물대가 픽스처에서 한 번도 안 나온다').toBe(true)
    expect(ids.has('volume_node_low'), '공백이 픽스처에서 한 번도 안 나온다').toBe(true)
  })
})

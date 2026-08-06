import { describe, it, expect } from 'vitest'
import { TAGS, TAG_BY_ID } from './taxonomy'
import { detectAll } from '../analysis/signals'
import { synthCandles } from '../analysis/fixtures'

describe('taxonomy 정합성', () => {
  it('id 가 중복되지 않는다', () => {
    expect(TAG_BY_ID.size).toBe(TAGS.length)
  })

  it('감지기가 배출하는 모든 id 가 taxonomy 에 있다', () => {
    // 감지기 없는 태그를 노출하면 사용자가 체크하는 족족 확정 ❌ 가 되고,
    // 반대로 taxonomy 에 없는 id 를 감지기가 내면 영구 유령 ⚠️놓침이 된다.
    const emitted = new Set(detectAll(synthCandles(600)).map((s) => s.id))
    const missing = [...emitted].filter((id) => !TAG_BY_ID.has(id))
    expect(missing, `taxonomy 에 없는 배출 id: ${missing.join(', ')}`).toEqual([])
  })

  it('zone 으로 선언된 태그는 감지기가 가격 구간을 채운다', () => {
    const zoneIds = new Set(TAGS.filter((d) => d.lifetime.kind === 'zone').map((d) => d.id))
    const sigs = detectAll(synthCandles(600)).filter((s) => zoneIds.has(s.id))
    expect(sigs.length, 'zone 태그가 픽스처에서 하나도 안 나오면 검증이 공허하다').toBeGreaterThan(0)
    for (const s of sigs) {
      expect(s.refs?.priceLow, `${s.id} @${s.barIndex} 에 priceLow 없음`).toBeTypeOf('number')
      expect(s.refs?.priceHigh, `${s.id} @${s.barIndex} 에 priceHigh 없음`).toBeTypeOf('number')
    }
  })

  it('taxonomy 의 tier·kind 가 감지기 출력과 일치한다', () => {
    for (const s of detectAll(synthCandles(600))) {
      const def = TAG_BY_ID.get(s.id)
      if (!def) continue
      expect(def.tier, `${s.id} tier 불일치`).toBe(s.tier)
      expect(def.kind, `${s.id} kind 불일치`).toBe(s.kind)
    }
  })
})

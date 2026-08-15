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

  // 여러 시드를 합쳐야 희귀 패턴(삼병·트라이스타 등)까지 나온다.
  // 10개면 충분히 빠르면서(<100ms) 49종 중 48종을 커버한다 — 남은 1종은
  // SYNTH_UNREACHABLE 참고.
  const COVERAGE_SEEDS = [1, 2, 3, 7, 11, 13, 17, 19, 23, 29]
  const COVERAGE_N = 1200

  /**
   * synthCandles 로는 구조적으로 재현 불가능한 태그. 근거 없이 추가 금지 —
   * 감지기의 임계값 수식을 직접 분석해 "왜 절대 안 나오는지"를 증명한 것만 올린다.
   * 아래 테스트가 이 목록에 있는 id 가 실제로 배출되면 실패하므로, 픽스처나
   * 감지기가 바뀌어 태그가 살아나면 이 목록에서 빼야 한다는 신호를 자동으로 받는다.
   */
  const SYNTH_UNREACHABLE = new Map<string, string>([
    [
      'vol_climax',
      'vol[i] >= 3*volMa[i] 조건인데 volMa(20) 이 현재 봉 자신을 포함해 계산되므로 ' +
        '이 부등식은 v[i] >= (3/17) * (나머지 19봉 합) 과 동치다. synthCandles 의 거래량은 ' +
        'Uniform[100,500) 이라 v[i] 는 500 을 절대 못 넘는데, 이를 만족하려면 나머지 19봉이 ' +
        '거의 전부 최솟값 부근에 몰려야 한다 — 500개 시드 × 3000봉(누적 150만 봉)을 순회해도 ' +
        '단 한 번도 발생하지 않았다 (calibrate.ts 실측 전 사전 검증, task-3 리뷰 대응).',
    ],
  ])

  it('TAGS 의 모든 태그는 감지기가 실제로 배출하거나, 배출 불가 사유가 명시돼 있다', () => {
    // emitted ⊆ taxonomy 는 위에서 이미 검증했다. 여기서는 반대 방향 —
    // taxonomy ⊇ emitted, 즉 감지기 없는 유령 태그가 없는지 — 를 검증한다.
    // 감지기 없는 태그는 사용자가 아무리 맞게 체크해도 영원히 오답 처리된다
    // (스펙이 지목한 최악의 실패 모드).
    const emitted = new Set<string>()
    for (const seed of COVERAGE_SEEDS) {
      for (const s of detectAll(synthCandles(COVERAGE_N, seed))) emitted.add(s.id)
    }

    const uncovered = TAGS.map((d) => d.id).filter((id) => !emitted.has(id) && !SYNTH_UNREACHABLE.has(id))
    expect(uncovered, `감지기도 안 내고 예외 목록에도 없는 유령 태그: ${uncovered.join(', ')}`).toEqual([])

    // 예외 목록은 고백이지 편의 도구가 아니다 — 실제로 배출되기 시작하면 목록이 썩는다.
    const staleExceptions = [...SYNTH_UNREACHABLE.keys()].filter((id) => emitted.has(id))
    expect(
      staleExceptions,
      `예외 목록에 있지만 실제로 배출됨 — 목록에서 제거해야 한다: ${staleExceptions.join(', ')}`,
    ).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import {
  coreSignals, grade, gradeEvidence, falseClaimPenalty,
  DEFAULT_CORE_K, FALSE_CLAIM_PENALTY,
} from './grader'
import { activeSignalsAt, type ActiveSignal } from './lifetime'
import { TAG_BY_ID, signalWeight, type TagDef } from './taxonomy'
import type { Answer, Question } from './types'
import { mk, synthCandles } from '../analysis/fixtures'
import type { Candle } from '../data/types'

// ── 픽스처 ──────────────────────────────────────────────────────────────────
//
// 신호는 실제 태그 id 로 만든다. 배점 권위가 taxonomy 의 WEIGHT 표라서 'a'/'b' 같은
// 가짜 id 는 전부 무게 0 이 되고, 그러면 정렬 테스트가 아무것도 검증하지 못한다.

const as = (id: string, strength: 1 | 2 | 3, barIndex: number): ActiveSignal => ({
  id,
  tier: TAG_BY_ID.get(id)?.tier ?? 1,
  kind: 'smc',
  side: 'bullish',
  barIndex,
  confidence: 'A',
  strength,
  evidence: '',
  ageBars: 0,
})

const DECISION = 199

const question = (candles: Candle[], over: Partial<Question> = {}): Question => ({
  symbol: 'T',
  timeframe: '4h',
  startTime: candles[0].time,
  decisionIndex: DECISION,
  type: 'normal',
  difficulty: 'medium',
  candles,
  ...over,
})

/** 유효 근거가 정확히 0개이고 ATR 이 딱 1, 피벗도 없는 창 */
const barren = (n: number, from = 0): Candle[] =>
  Array.from({ length: n }, (_, i) => mk(100, 101, 100, 101, 100, from + i))
/** 도지 평평 — 유효 근거 2개(candle_doji, candle_tri_star), ATR 1 */
const dojiFlat = (n: number, from = 0): Candle[] =>
  Array.from({ length: n }, (_, i) => mk(100, 100.5, 99.5, 100, 100, from + i))

/** 근거가 여러 종류 살아 있는 창. 결정 봉 close 112.91, ATR 2.264, 직전 스윙 로우 104.74 */
const REAL = synthCandles(400, 42).slice(0, DECISION + 1)
const tailUp = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => mk(112.9, 122.9, 112.4, 122.0, 100, DECISION + 1 + i))
const tailDown = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => mk(112.9, 113.4, 102.9, 103.8, 100, DECISION + 1 + i))
/**
 * 어느 쪽으로도 1.5 ATR 을 못 가는 꼬리 → 정답이 관망인 문제.
 * 결정 봉 close 112.91, ATR 2.264 이므로 1.5 ATR ≈ 3.4. 폭을 ±0.5 로 둔다.
 */
const tailFlat = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => mk(112.9, 113.4, 112.4, 112.9, 100, DECISION + 1 + i))

const realQ = (tail: Candle[]) => question([...REAL, ...tail])

/** grade 와 같은 창 규칙으로 정답 근거를 뽑는다 */
const activeOf = (q: Question) => activeSignalsAt(q.candles.slice(0, q.decisionIndex + 1), q.decisionIndex)
const coreTagsOf = (q: Question) => coreSignals(activeOf(q), DEFAULT_CORE_K).map((s) => s.id)

/** TAG_BY_ID 에 임시 태그를 등록하고 끝나면 반드시 되돌린다 */
function withTempTags<T>(defs: TagDef[], fn: () => T): T {
  for (const d of defs) TAG_BY_ID.set(d.id, d)
  try {
    return fn()
  } finally {
    for (const d of defs) TAG_BY_ID.delete(d.id)
  }
}

const tempTag = (id: string, confidence: 'A' | 'B' | 'C'): TagDef => ({
  id, label: id, tier: 1, kind: 'smc', confidence, lifetime: { kind: 'bar' }, weight: 4,
})

// ── 픽스처 전제 ─────────────────────────────────────────────────────────────

describe('픽스처 전제', () => {
  it('테스트가 기대는 태그 배점이 실제 값과 같다', () => {
    expect(signalWeight({ id: 'liq_sweep_low', strength: 3 })).toBe(12)
    expect(signalWeight({ id: 'ob_bull_support', strength: 3 })).toBe(9)
    expect(signalWeight({ id: 'ob_bull_support', strength: 1 })).toBe(3)
    expect(signalWeight({ id: 'candle_doji', strength: 1 })).toBe(2)
    expect(signalWeight({ id: 'msb_bull', strength: 1 })).toBe(2)
  })

  it('헛다리 감점의 크기가 고정돼 있다', () => {
    // 다른 감점 단언은 전부 FALSE_CLAIM_PENALTY 로 쓰여 있어서, 이 상수를 0.7~15 사이
    // 아무 값으로 바꿔도 테스트가 하나도 안 깨진다(산탄총 회귀 포함 — 헛다리 44개 ×
    // 0.7 이면 여전히 30 을 넘는다). 비율은 고정돼 있는데 기준선이 떠 있는 상태였다.
    expect(FALSE_CLAIM_PENALTY).toBe(3)
  })

  it('barren 창에는 유효 근거가 하나도 없고 dojiFlat 에는 둘 있다', () => {
    expect(activeOf(question(barren(DECISION + 61)))).toEqual([])
    expect(activeOf(question(dojiFlat(DECISION + 61))).map((s) => s.id).sort())
      .toEqual(['candle_doji', 'candle_tri_star'])
  })
})

// ── coreSignals ─────────────────────────────────────────────────────────────

describe('coreSignals', () => {
  it('signalWeight(태그 배점 × 강도) 내림차순 상위 K개를 낸다', () => {
    // liq_sweep_low 4×1=4, ob_bull_support 3×3=9, candle_doji 2×2=4
    const sigs = [as('liq_sweep_low', 1, 10), as('ob_bull_support', 3, 10), as('candle_doji', 2, 10)]
    expect(coreSignals(sigs, 2).map((s) => s.id)).toEqual(['ob_bull_support', 'candle_doji'])
  })

  it('tier 가 아니라 태그 배점을 쓴다 — 스윕(4)이 오더블록(3)을 이긴다', () => {
    // 감지기는 둘 다 tier:1 로 배출한다. TIER_WEIGHT 로는 구분되지 않는 쌍이다.
    const sigs = [as('ob_bull_support', 1, 10), as('liq_sweep_low', 1, 10)]
    expect(coreSignals(sigs, 1).map((s) => s.id)).toEqual(['liq_sweep_low'])
  })

  it('같은 태그가 여러 번 살아 있어도 핵심 슬롯은 하나만 차지한다', () => {
    // 실측: 실제로 출제된 문제 104개 전부가 같은 id 중복을 갖는다(원본 13.5개 → 고유 9.1개).
    // 인스턴스 단위로 자르면 K개 슬롯이 한두 태그로 다 채워져 핵심 계층이 무너진다.
    const sigs = [
      as('liq_sweep_low', 3, 10), as('liq_sweep_low', 3, 12), as('liq_sweep_low', 2, 14),
      as('ob_bull_support', 1, 11), as('msb_bull', 1, 13),
    ]
    expect(coreSignals(sigs, 3).map((s) => s.id)).toEqual(['liq_sweep_low', 'ob_bull_support', 'msb_bull'])
  })

  it('같은 태그의 대표는 가중치가 가장 큰 인스턴스다', () => {
    const sigs = [as('ob_bull_support', 1, 10), as('ob_bull_support', 3, 11)]
    const core = coreSignals(sigs, 1)
    expect(core).toHaveLength(1)
    expect(core[0].strength).toBe(3)
  })

  it('동점이면 barIndex 최신 우선, 그래도 같으면 id 사전순', () => {
    // fvg_bear 4×1, fvg_bull 4×1, msb_bull 2×2 — 셋 다 무게 4
    const sigs = [as('fvg_bear', 1, 10), as('fvg_bull', 1, 10), as('msb_bull', 2, 20)]
    expect(coreSignals(sigs, 3).map((s) => s.id)).toEqual(['msb_bull', 'fvg_bear', 'fvg_bull'])
  })

  it('K 가 고유 태그 수보다 크면 전부 낸다', () => {
    expect(coreSignals([as('liq_sweep_low', 1, 10)], 5)).toHaveLength(1)
  })

  it('K 가 0 이하면 빈 배열이다 — slice(0, 음수)로 뒤에서 잘리지 않는다', () => {
    const sigs = [as('liq_sweep_low', 1, 10), as('ob_bull_support', 1, 11)]
    expect(coreSignals(sigs, 0)).toEqual([])
    expect(coreSignals(sigs, -1)).toEqual([])
  })

  it('입력 순서를 뒤섞어도 결과가 같다 — 정렬이 완전순서다', () => {
    const sigs = [
      as('liq_sweep_low', 1, 10), as('ob_bull_support', 1, 10),
      as('msb_bull', 2, 10), as('fvg_bull', 1, 10), as('candle_doji', 1, 10),
    ]
    const forward = coreSignals(sigs, 3).map((s) => s.id)
    expect(coreSignals([...sigs].reverse(), 3).map((s) => s.id)).toEqual(forward)
  })

  it('기본 K 는 실측으로 정한 5 다', () => {
    expect(DEFAULT_CORE_K).toBe(5)
  })
})

// ── 방향 축 ─────────────────────────────────────────────────────────────────

describe('grade — 방향 축', () => {
  const up = (n: number) => Array.from({ length: n }, (_, i) => mk(100, 110, 99.5, 109, 100, DECISION + 1 + i))
  const q = (hidden: Candle[]): Question => question([...dojiFlat(DECISION + 1), ...hidden])

  it('방향이 맞으면 30점', () => {
    const r = grade(q(up(60)), { direction: 'long', entry: 100, stopLoss: 98, takeProfit: 104, tags: [] })
    expect(r.direction.correct).toBe('long')
    expect(r.direction.score).toBe(30)
  })

  it('방향이 있는데 관망하면 12점 — 기회는 놓쳤으나 손실은 없다', () => {
    expect(grade(q(up(60)), { direction: 'flat', tags: [] }).direction.score).toBe(12)
  })

  it('방향이 반대면 0점', () => {
    const r = grade(q(up(60)), { direction: 'short', entry: 100, stopLoss: 102, takeProfit: 96, tags: [] })
    expect(r.direction.score).toBe(0)
  })

  it('무방향에 관망이면 30점', () => {
    const r = grade(q(dojiFlat(60, DECISION + 1)), { direction: 'flat', tags: [] })
    expect(r.direction.correct).toBe('flat')
    expect(r.direction.score).toBe(30)
  })

  it('무방향인데 진입하면 5점', () => {
    const r = grade(q(dojiFlat(60, DECISION + 1)), { direction: 'long', entry: 100, stopLoss: 98, takeProfit: 104, tags: [] })
    expect(r.direction.score).toBe(5)
  })

  it('answered 를 답안 그대로 되돌려 준다', () => {
    const r = grade(q(up(60)), { direction: 'short', entry: 100, stopLoss: 102, takeProfit: 96, tags: [] })
    expect(r.direction.answered).toBe('short')
  })
})

// ── 실행 축 ─────────────────────────────────────────────────────────────────

describe('grade — 실행 축', () => {
  // barren 창: ATR 정확히 1, 피벗 없음(모든 봉이 같아 좌우 극단이 성립하지 않는다)
  const q = question(barren(DECISION + 61))
  const ex = (a: Partial<Answer>) =>
    grade(q, { direction: 'long', entry: 100, stopLoss: 98, takeProfit: 104, tags: [], ...a }).execution

  it('손절폭·R:R 이 모두 무난하면 만점이다', () => {
    expect(ex({}).score).toBe(40)
  })

  it('관망이면 실행 축을 판정 대상에서 뺀다 — 만점이 아니라 max 0 이다', () => {
    // "감점하지 않는다" 와 "만점을 준다" 는 다른 연산이다. 만점을 주면 아무것도 재지
    // 않은 축에서 40점이 나와, 아무 분석도 안 한 관망 답안이 절반을 넘긴다.
    const e = ex({ direction: 'flat', entry: undefined, stopLoss: undefined, takeProfit: undefined })
    expect(e.score).toBe(0)
    expect(e.max).toBe(0)
    expect(e.orderValid).toBe(true)
    expect(e.notes.join(' ')).toContain('관망')
  })

  it('진입가나 손절가가 없으면 실행을 평가할 수 없어 0점이다', () => {
    expect(ex({ stopLoss: undefined }).score).toBe(0)
    expect(ex({ entry: undefined }).score).toBe(0)
  })

  it('롱인데 손절가가 진입가 위면 0점이다 — 주문으로 성립하지 않는다', () => {
    const e = ex({ stopLoss: 102 })
    expect(e.score).toBe(0)
    expect(e.notes.join(' ')).toContain('손절가')
  })

  it('숏인데 손절가가 진입가 아래면 0점이다', () => {
    expect(ex({ direction: 'short', stopLoss: 98, takeProfit: 96 }).score).toBe(0)
  })

  it('손절가가 진입가와 같으면 0점이다 — 위험이 정의되지 않는다', () => {
    expect(ex({ stopLoss: 100 }).score).toBe(0)
  })

  it('손절폭이 0.5 ATR 미만이면 감점한다', () => {
    const e = ex({ stopLoss: 99.6 })   // 0.4 ATR
    expect(e.score).toBe(25)
    expect(e.notes.join(' ')).toContain('노이즈')
  })

  it('손절폭이 4 ATR 을 넘으면 감점한다', () => {
    expect(ex({ stopLoss: 95, takeProfit: 110 }).score).toBe(25)   // 5 ATR, R:R 2.0
  })

  it('R:R 이 1.5 미만이면 감점한다', () => {
    expect(ex({ takeProfit: 102 }).score).toBe(30)   // R:R 1.0
  })

  it('익절가가 없으면 R:R 을 판정할 수 없으므로 감점한다 — 생략이 이득이 되면 안 된다', () => {
    const e = ex({ takeProfit: undefined })
    expect(e.score).toBe(30)
    expect(e.notes.join(' ')).toContain('R:R')
  })

  it('익절가가 진입가의 반대편이면 감점한다', () => {
    expect(ex({ takeProfit: 98 }).score).toBe(30)
  })

  it('직전 스윙 로우 아래 손절이면 가산이 붙는다', () => {
    const rq = realQ(tailUp(60))
    const below = grade(rq, { direction: 'long', entry: 112, stopLoss: 104, tags: [] }).execution
    const above = grade(rq, { direction: 'long', entry: 112, stopLoss: 105, tags: [] }).execution
    expect(below.score).toBe(above.score + 5)
    expect(below.notes.join(' ')).toContain('구조적 손절')
  })

  it('점수는 0~40 범위를 벗어나지 않는다', () => {
    expect.hasAssertions()
    for (const stopLoss of [99.99, 99.6, 98, 95, 1, 100, 101]) {
      for (const takeProfit of [undefined, 98, 100, 102, 104, 1000]) {
        const e = ex({ stopLoss, takeProfit })
        expect(e.score).toBeGreaterThanOrEqual(0)
        expect(e.score).toBeLessThanOrEqual(40)
      }
    }
  })
})

// ── 근거 축 ─────────────────────────────────────────────────────────────────

describe('gradeEvidence — 핵심/참고 2단', () => {
  it('유효 근거가 하나도 없으면 아무것도 체크하지 않은 답이 만점이다', () => {
    // 짚을 게 없는 자리에서 아무것도 안 짚은 것은 정답이지 0점이 아니다
    const r = gradeEvidence([], [], DEFAULT_CORE_K)
    expect(r.score).toBe(30)
    expect(r.verdict.coreMisses).toEqual([])
  })

  it('유효 근거가 없는데 체크하면 전부 헛다리로 감점한다', () => {
    const r = gradeEvidence([], ['liq_sweep_low', 'ob_bull_support'], DEFAULT_CORE_K)
    expect(r.verdict.falseClaims).toEqual(['liq_sweep_low', 'ob_bull_support'])
    expect(r.score).toBe(30 - 2 * FALSE_CLAIM_PENALTY)
  })

  it('핵심을 전부 짚으면 30점, 참고만 짚으면 0점이다 — 경계가 점수를 가른다', () => {
    const active = [
      as('liq_sweep_low', 3, 10),      // 12
      as('ob_bull_support', 3, 11),    //  9
      as('msb_bull', 1, 12),           //  2
      as('candle_doji', 1, 13),        //  2
    ]
    const k = 2
    const core = coreSignals(active, k).map((s) => s.id)
    const ref = active.map((s) => s.id).filter((id) => !core.includes(id))
    expect(core).toEqual(['liq_sweep_low', 'ob_bull_support'])

    expect(gradeEvidence(active, core, k).score).toBe(30)
    expect(gradeEvidence(active, ref, k).score).toBe(0)
  })

  it('참고를 체크하지 않아도 감점이 없다 — 목록에만 오른다', () => {
    const active = [as('liq_sweep_low', 3, 10), as('candle_doji', 1, 11)]
    const full = gradeEvidence(active, ['liq_sweep_low', 'candle_doji'], 1)
    const coreOnly = gradeEvidence(active, ['liq_sweep_low'], 1)
    expect(coreOnly.score).toBe(full.score)
    expect(coreOnly.verdict.reference).toEqual(['candle_doji'])
    expect(coreOnly.verdict.coreMisses).toEqual([])
  })

  it('놓친 핵심의 무게만큼 깎인다 — 개수가 아니다', () => {
    const active = [
      as('liq_sweep_low', 3, 10),      // 12
      as('ob_bull_support', 3, 11),    //  9
      as('candle_doji', 1, 12),        //  2
    ]
    // 핵심 3개 총 무게 23. 12를 놓치면 11/23, 2를 놓치면 21/23
    const heavy = gradeEvidence(active, ['ob_bull_support', 'candle_doji'], 3)
    const light = gradeEvidence(active, ['liq_sweep_low', 'ob_bull_support'], 3)
    expect(heavy.score).toBe(Math.round((30 * 11) / 23))
    expect(light.score).toBe(Math.round((30 * 21) / 23))
    expect(heavy.score).toBeLessThan(light.score)
  })

  it('네 판정이 서로 겹치지 않는다', () => {
    const active = [as('liq_sweep_low', 3, 10), as('ob_bull_support', 2, 11), as('candle_doji', 1, 12)]
    const { verdict } = gradeEvidence(active, ['liq_sweep_low', 'macd_dead'], 2)
    const all = [verdict.hits, verdict.coreMisses, verdict.reference, verdict.falseClaims]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(all[i].filter((x) => all[j].includes(x))).toEqual([])
      }
    }
    expect(verdict.hits).toEqual(['liq_sweep_low'])
    expect(verdict.coreMisses).toEqual(['ob_bull_support'])
    expect(verdict.reference).toEqual(['candle_doji'])
    expect(verdict.falseClaims).toEqual(['macd_dead'])
  })

  it('같은 태그를 두 번 체크해도 한 번만 센다', () => {
    const once = gradeEvidence([], ['liq_sweep_low'], DEFAULT_CORE_K)
    const twice = gradeEvidence([], ['liq_sweep_low', 'liq_sweep_low'], DEFAULT_CORE_K)
    expect(twice.score).toBe(once.score)
    expect(twice.verdict.falseClaims).toEqual(['liq_sweep_low'])
  })

  it('태그 순서를 바꿔도 판정이 완전히 같다', () => {
    const active = [as('liq_sweep_low', 3, 10), as('ob_bull_support', 2, 11), as('candle_doji', 1, 12)]
    const tags = ['candle_doji', 'macd_dead', 'liq_sweep_low']
    expect(gradeEvidence(active, [...tags].reverse(), 2)).toEqual(gradeEvidence(active, tags, 2))
  })
})

describe('grade — 근거 축 (실제 창)', () => {
  const q = question(dojiFlat(DECISION + 61), { type: 'no_setup' })

  it('존재하지 않는 근거를 체크하면 헛다리로 잡는다', () => {
    const r = grade(q, { direction: 'flat', tags: ['ob_bull_support', 'liq_sweep_low'] })
    // 평평한 픽스처에는 오더블록도 스윕도 없다
    expect(r.evidence.verdict.falseClaims).toEqual(['liq_sweep_low', 'ob_bull_support'])
  })

  it('taxonomy 에 없는 태그도 헛다리다 — 무시하지도, 터지지도 않는다', () => {
    // 근거가 0개인 창에서 재야 감점이 그대로 드러난다 (dojiFlat 은 핵심 2개가 있어
    // 미체크 커버리지 0이 감점을 덮어버린다)
    const r = grade(question(barren(DECISION + 61)), { direction: 'flat', tags: ['존재하지_않는_태그'] })
    expect(r.evidence.verdict.falseClaims).toEqual(['존재하지_않는_태그'])
    expect(r.evidence.score).toBe(30 - FALSE_CLAIM_PENALTY)
  })

  it('실재하는 근거를 짚으면 적중으로 잡는다', () => {
    const r = grade(q, { direction: 'flat', tags: ['candle_doji'] })
    expect(r.evidence.verdict.hits).toContain('candle_doji')
    expect(r.evidence.verdict.falseClaims).toEqual([])
  })

  it('핵심과 참고가 겹치지 않고 핵심은 K개다', () => {
    const r = grade(realQ(tailUp(60)), { direction: 'flat', tags: [] })
    const { coreMisses, reference } = r.evidence.verdict
    expect(coreMisses.filter((x) => reference.includes(x))).toEqual([])
    expect(coreMisses).toHaveLength(DEFAULT_CORE_K)
    expect(reference.length).toBeGreaterThan(0)
  })

  it('점수는 0~30 범위를 벗어나지 않는다', () => {
    const r = grade(q, { direction: 'flat', tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'] })
    expect(r.evidence.score).toBe(0)
  })

  it('전 태그를 다 찍으면 0점이다 — 산탄총이 이기는 전략이 되면 안 된다', () => {
    // 핵심은 전부 덮이지만(커버리지 1) 유효하지 않은 40여 종이 전부 헛다리가 된다
    const rq = realQ(tailUp(60))
    const all = [...TAG_BY_ID.keys()]
    const r = grade(rq, { direction: 'flat', tags: all })
    expect(r.evidence.verdict.coreMisses).toEqual([])
    expect(r.evidence.verdict.falseClaims.length).toBeGreaterThan(30)
    expect(r.evidence.score).toBe(0)
  })
})

// ── confidence 차등 (스펙 6.7) ──────────────────────────────────────────────

describe('헛다리 감점의 confidence 차등 — A 100% / B 50% / C 0%', () => {
  it('감점 강도가 등급별로 갈린다', () => {
    withTempTags([tempTag('tmp_a', 'A'), tempTag('tmp_b', 'B'), tempTag('tmp_c', 'C')], () => {
      expect(falseClaimPenalty('tmp_a')).toBe(FALSE_CLAIM_PENALTY)
      expect(falseClaimPenalty('tmp_b')).toBe(FALSE_CLAIM_PENALTY / 2)
      expect(falseClaimPenalty('tmp_c')).toBe(0)
    })
  })

  it('taxonomy 에 없는 태그는 A 로 본다 — 확인할 방법이 없는 주장이 가장 센 헛다리다', () => {
    expect(falseClaimPenalty('전혀_없는_태그')).toBe(FALSE_CLAIM_PENALTY)
  })

  it('등급 차등이 실제 점수까지 전달된다', () => {
    const defs = (['a', 'b', 'c'] as const).flatMap((c) =>
      [tempTag(`tmp_${c}1`, c.toUpperCase() as 'A' | 'B' | 'C'), tempTag(`tmp_${c}2`, c.toUpperCase() as 'A' | 'B' | 'C')])
    withTempTags(defs, () => {
      // 같은 등급 2개씩 — 0.5 반올림 경계에 걸리지 않게 한다
      const s = (c: string) => gradeEvidence([], [`tmp_${c}1`, `tmp_${c}2`], DEFAULT_CORE_K).score
      expect(s('a')).toBe(30 - 2 * FALSE_CLAIM_PENALTY)
      expect(s('b')).toBe(30 - FALSE_CLAIM_PENALTY)
      expect(s('c')).toBe(30)
    })
  })

  it('임시 태그가 테스트 뒤에 남지 않는다', () => {
    expect(TAG_BY_ID.has('tmp_a')).toBe(false)
    expect(TAG_BY_ID.has('tmp_a1')).toBe(false)
  })

  /**
   * Part 2 가 "현재 taxonomy 는 전부 A 다 — B·C 는 나중에 들어온다" 로 심어 둔
   * 자리다. Part 5 에서 추세선 5종이 B 로 들어오며 그 전제가 깨졌고, 이제는
   * **A 와 B 가 공존한다**는 것을 고정한다. C 는 아직 없다(와이코프·하모닉 파트).
   */
  it('A 와 B 가 공존하고 C 는 아직 없다', () => {
    const grades = new Set([...TAG_BY_ID.values()].map((d) => d.confidence))
    expect(grades.has('A')).toBe(true)
    expect(grades.has('B')).toBe(true)
    expect(grades.has('C')).toBe(false)
  })
})

// ── 프로세스와 결과의 분리 ───────────────────────────────────────────────────

describe('grade — 프로세스와 결과의 분리', () => {
  // 은닉 구간이 갈리면 이 답안의 운명도 갈린다 — 위로 가면 익절, 아래로 가면 손절.
  // 결과가 양쪽에서 정반대가 되어야 "실행 축에 재생 결과를 섞으면 잡힌다" 가 성립한다.
  const answer: Answer = {
    direction: 'long', entry: 112.5, stopLoss: 107, takeProfit: 118,
    tags: ['liq_sweep_high', 'ob_bull_support'],
  }

  it('프로세스 점수와 결과 점수를 따로 낸다', () => {
    const r = grade(realQ(tailUp(60)), answer)
    expect(r.processScore).toBe(r.evidence.score + r.execution.score)
    expect(r.outcomeScore).toBe(r.direction.score)
    expect(r.totalScore).toBe(r.direction.score + r.execution.score + r.evidence.score)
    expect(r.judgement.length).toBeGreaterThan(0)
  })

  it('은닉 구간을 바꿔도 프로세스 점수는 한 톨도 변하지 않는다', () => {
    // 이 테스트가 실행 축에 재생 PnL 을 섞는 것을 막는다 (스펙 7.1 과 7.2 가 충돌하는 지점)
    const up = grade(realQ(tailUp(60)), answer)
    const down = grade(realQ(tailDown(60)), answer)

    expect(up.evidence).toEqual(down.evidence)
    expect(up.execution).toEqual(down.execution)
    expect(up.processScore).toBe(down.processScore)

    // 위 동일성이 "양쪽 다 아무 일도 없었다" 라서가 아니라는 것까지 확인한다.
    // 같은 답안이 한쪽에서는 익절하고 다른 쪽에서는 손절당한다 — 실행 점수에 재생
    // 결과를 조금이라도 섞으면 위 toEqual 이 반드시 깨진다.
    expect(up.direction.correct).toBe('long')
    expect(down.direction.correct).toBe('short')
    expect(up.outcomeScore).not.toBe(down.outcomeScore)
    expect(up.replay!.exit).toBe('tp')
    expect(down.replay!.exit).toBe('sl')
    expect(up.replay!.r).toBeGreaterThan(0)
    expect(down.replay!.r).toBeLessThan(0)
  })

  it('답안의 손절가를 바꿔도 방향 점수는 변하지 않는다', () => {
    const q = realQ(tailUp(60))
    const tight = grade(q, { ...answer, stopLoss: 111.9 })
    const wide = grade(q, { ...answer, stopLoss: 104 })
    expect(tight.direction).toEqual(wide.direction)
    expect(tight.execution.score).not.toBe(wide.execution.score)
  })
})

// ── 판정 문구는 측정한 사실만 말한다 ──────────────────────────────────────────

describe('grade — 판정 문구', () => {
  it('실행이 나쁘면 손절당해도 "잘한 매매" 로 부르지 않는다', () => {
    // 핵심 근거는 전부 짚었지만 손절폭이 0.1 ATR — 합계만 보면 통과하는 자리다
    const q = realQ(tailDown(60))
    const r = grade(q, {
      direction: 'long', entry: 112.91, stopLoss: 112.68, takeProfit: 113.5, tags: coreTagsOf(q),
    })
    expect(r.evidence.score).toBe(30)
    expect(r.execution.score).toBeLessThan(28)
    expect(r.processScore).toBeGreaterThanOrEqual(50)   // 브리프의 합계 기준이면 통과했을 값
    expect(r.replay!.exit).toBe('sl')
    expect(r.judgement).not.toContain('잘한 매매')
  })

  it('체결되지 않았으면 손익 숫자를 주장하지 않는다', () => {
    const r = grade(realQ(tailUp(60)), { direction: 'long', entry: 10, stopLoss: 9, takeProfit: 30, tags: [] })
    expect(r.replay!.filled).toBe(false)
    expect(r.judgement).toContain('체결되지 않았습니다')
    expect(r.judgement).not.toMatch(/-?\d+(\.\d+)?R/)
  })

  it('프로세스가 높은데 손절당하면 잘한 매매로 부른다', () => {
    const q = realQ(tailDown(60))
    const r = grade(q, {
      direction: 'long', entry: 112.5, stopLoss: 107, takeProfit: 130, tags: coreTagsOf(q),
    })
    expect(r.execution.score).toBe(40)
    expect(r.evidence.score).toBe(30)
    expect(r.replay!.exit).toBe('sl')
    expect(r.judgement).toContain('잘한 매매')
  })

  it('프로세스가 낮은데 이겼으면 운이라고 부른다', () => {
    const q = realQ(tailUp(60))
    const r = grade(q, {
      direction: 'long', entry: 112.5, stopLoss: 112.3, takeProfit: 118,
      tags: ['candle_hammer', 'macd_golden', 'rsi_oversold'],   // 셋 다 이 시점에 없다
    })
    expect(r.evidence.verdict.falseClaims).toHaveLength(3)
    expect(r.replay!.r).toBeGreaterThan(0)
    expect(r.processScore).toBeLessThan(35)
    expect(r.judgement).toContain('운입니다')
  })

  it('관망이면 관망이라고 말한다', () => {
    const r = grade(realQ(tailUp(60)), { direction: 'flat', tags: [] })
    expect(r.judgement).toContain('관망')
    expect(r.judgement).not.toMatch(/-?\d+(\.\d+)?R/)
  })
})

// ── 결정론 ──────────────────────────────────────────────────────────────────

describe('grade — 점수 척도와 빈 관망', () => {
  // 이 결함이 새어나간 이유가 바로 "총점을 못 박은 테스트가 하나도 없었다" 는 것이다.
  // 아무 분석도 하지 않은 답안이 몇 점을 받는지는 이 도구의 눈금 자체이므로 고정한다.

  const emptyFlat: Answer = { direction: 'flat', tags: [] }

  it('진입 답안은 적용 만점이 100이고 환산이 항등이다', () => {
    const q = realQ(tailUp(60))
    const r = grade(q, { direction: 'long', entry: 112.91, stopLoss: 107, takeProfit: 118, tags: [] })
    expect(r.applicableMax).toBe(100)
    expect(r.totalScore).toBe(r.direction.score + r.execution.score + r.evidence.score)
  })

  it('관망 답안은 실행 축이 빠져 적용 만점이 60이다', () => {
    const r = grade(realQ(tailUp(60)), emptyFlat)
    expect(r.applicableMax).toBe(60)
    expect(r.execution.max).toBe(0)
    expect(r.processMax).toBe(30)
  })

  it('방향이 있는 문제에 빈 관망은 20점이다 — 예전엔 52점이었다', () => {
    // 방향 12 + 실행 판정없음 + 근거 0 = 12/60 → 20.
    // 예전 규칙은 재지도 않은 실행 축에 40점을 줘서 12+40+0 = 52 를 만들었다.
    const r = grade(realQ(tailUp(60)), emptyFlat)
    expect(r.direction.correct).not.toBe('flat')
    expect(r.direction.score).toBe(12)
    expect(r.evidence.score).toBe(0)
    expect(r.totalScore).toBe(20)
  })

  it('노셋업 문제에 빈 관망은 50점이다 — 예전엔 70점이었다', () => {
    // 방향은 맞았지만(30) 근거를 하나도 짚지 않았다(0) → 30/60 → 50.
    // 방향만 맞히고 아무 근거도 못 대는 답안이 만점을 받아선 안 된다.
    const q = realQ(tailFlat(60))
    const r = grade(q, emptyFlat)
    expect(r.direction.correct).toBe('flat')
    expect(r.direction.score).toBe(30)
    expect(r.totalScore).toBe(50)
  })

  it('노셋업을 근거까지 맞히면 100점에 도달한다 — 환산이 정답을 깎지 않는다', () => {
    const q = realQ(tailFlat(60))
    const core = coreTagsOf(q)
    expect(core.length).toBeGreaterThan(0)
    const r = grade(q, { direction: 'flat', tags: core })
    expect(r.evidence.score).toBe(30)
    expect(r.totalScore).toBe(100)
  })
})

describe('grade — 성립하지 않는 주문', () => {
  it('롱인데 손절가가 위면 손익을 사실로 말하지 않는다', () => {
    // replay 의 R 환산은 |entry − stopLoss| 를 쓰므로 이런 답안에 +1R 을 돌려준다.
    // 채점기가 실행 0점으로 실격시켜 놓고 판정 문구에서는 "+1.0R 인데 ... 운입니다" 라고
    // 말하면, 자기가 방금 존재할 수 없다고 판정한 매매의 이익을 사실로 보고하는 것이다.
    const r = grade(realQ(tailDown(60)), {
      direction: 'long', entry: 112.91, stopLoss: 118, takeProfit: 125, tags: [],
    })
    expect(r.execution.orderValid).toBe(false)
    expect(r.execution.score).toBe(0)
    expect(r.judgement).toContain('성립하지 않는 주문')
    expect(r.judgement).not.toMatch(/\+\d/)
    expect(r.judgement).not.toContain('운입니다')
  })

  it('불성립 주문에는 재생 결과를 아예 싣지 않는다 — 리포트가 그릴 수 없어야 한다', () => {
    // 판정 문구만 막으면 절반이다. 리포트가 report.replay.r 을 직접 그리면 같은 거짓이
    // 다른 경로로 나간다. 실측: 이 답안에서 replay 는 exit 'sl' 에 r +1.0 을 돌려준다
    // (risk 를 절댓값으로 재기 때문). null 로 두어 타입이 소비자를 막게 한다.
    const r = grade(realQ(tailDown(60)), {
      direction: 'long', entry: 112.91, stopLoss: 118, takeProfit: 125, tags: [],
    })
    expect(r.replay).toBeNull()
  })

  it('정상 주문에는 재생 결과가 실린다', () => {
    const r = grade(realQ(tailUp(60)), {
      direction: 'long', entry: 112.91, stopLoss: 107, takeProfit: 118, tags: [],
    })
    expect(r.replay).not.toBeNull()
    expect(r.replay!.exit).toBe('tp')
  })

  it('정상 주문은 orderValid 가 참이다', () => {
    const r = grade(realQ(tailUp(60)), {
      direction: 'long', entry: 112.91, stopLoss: 107, takeProfit: 118, tags: [],
    })
    expect(r.execution.orderValid).toBe(true)
  })
})

/**
 * Part 5 게이트 7 — B등급 경로가 실제로 켜졌는지 고정한다.
 *
 * CONFIDENCE_FACTOR 는 Part 2 에서 만들어졌지만 Part 4 까지 **모든 태그가 A등급이라
 * 한 번도 실행되지 않았다.** 추세선 5종이 첫 B등급 소비자다. 이 검사가 없으면
 * "B 를 도입했는데 감점이 그대로였다" 를 아무도 모른다.
 */
describe('confidence 등급별 감점 차등', () => {
  it('B등급 헛다리는 A등급의 절반만 깎는다', () => {
    const a = falseClaimPenalty('liq_sweep_low')       // A등급
    const b = falseClaimPenalty('trendline_support')   // B등급
    expect(a).toBe(FALSE_CLAIM_PENALTY)
    expect(b).toBe(FALSE_CLAIM_PENALTY / 2)
  })

  it('추세선 5종이 전부 B등급이다', () => {
    for (const id of ['trendline_support', 'trendline_resistance', 'trendline_break',
      'channel_upper', 'channel_lower']) {
      expect(TAG_BY_ID.get(id)?.confidence, `${id} 가 B등급이 아니다`).toBe('B')
    }
  })

  it('taxonomy 에 없는 id 는 A로 본다 — 확인할 방법이 없는 주장이 가장 센 헛다리다', () => {
    expect(falseClaimPenalty('존재하지_않는_태그')).toBe(FALSE_CLAIM_PENALTY)
  })
})

describe('grade — 결정론', () => {
  it('같은 입력은 항상 같은 리포트를 낸다', () => {
    const q = realQ(tailUp(60))
    const a: Answer = {
      direction: 'long', entry: 112, stopLoss: 104, takeProfit: 130,
      tags: ['liq_sweep_high', 'macd_dead'],
    }
    expect(grade(q, a)).toEqual(grade(q, a))
  })

  it('체크 순서를 바꿔도 리포트가 같다', () => {
    const q = realQ(tailUp(60))
    const tags = ['macd_dead', 'liq_sweep_high', 'ob_bull_support']
    const base: Answer = { direction: 'long', entry: 112, stopLoss: 104, takeProfit: 130, tags }
    expect(grade(q, { ...base, tags: [...tags].reverse() })).toEqual(grade(q, base))
  })
})

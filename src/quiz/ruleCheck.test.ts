import { describe, it, expect } from 'vitest'
import { ruleCheck, PROFILES, PROFILE_OF, type RuleProfile } from './ruleCheck'
import { TAGS } from './taxonomy'
import type { ActiveSignal } from './lifetime'
import type { SignalSide } from '../analysis/signalTypes'
import { TIMEFRAMES } from '../data/types'

const sig = (id: string, side: SignalSide, barIndex = 100): ActiveSignal => ({
  id, tier: 1, kind: 'smc', side, barIndex,
  confidence: 'A', strength: 1, evidence: '', ageBars: 0,
})

const rowOf = (r: ReturnType<typeof ruleCheck>, key: string) => r.rows.find((x) => x.key === key)!

// ── 엑셀 충실도 ─────────────────────────────────────────────────────────────
//
// 이 표는 사용자의 트레이딩 시스템 원본(locked_advanced_trading_system.xlsx)이다.
// 숫자가 조용히 어긋나면 룰 패널이 사용자 기준이 아니라 우리 기준을 말하게 된다.

describe('엑셀 원본 충실도', () => {
  it('컷라인이 시트대로다 — 단타 12 / 스윙 16 / 장기 17', () => {
    expect(PROFILES.scalp.cutline).toBe(12)
    expect(PROFILES.swing.cutline).toBe(16)
    expect(PROFILES.position.cutline).toBe(17)
  })

  it('시너지 종류가 프로파일마다 다르다 — 장기만 MA Combo 다', () => {
    expect(PROFILES.scalp.synergy).toBe('golden_combo')
    expect(PROFILES.swing.synergy).toBe('golden_combo')
    expect(PROFILES.position.synergy).toBe('ma_combo')
    for (const p of Object.values(PROFILES)) expect(p.synergyBonus).toBe(2)
  })

  it('같은 항목이라도 프로파일마다 배점이 다르다', () => {
    const w = (p: RuleProfile, key: string) => PROFILES[p].rows.find((r) => r.key === key)?.weight
    // 유동성 청산: 단타 5 > 스윙 4 > 장기 3
    expect([w('scalp', 'sweep'), w('swing', 'sweep'), w('position', 'sweep')]).toEqual([5, 4, 3])
    // 추세 구조: 장기 5 > 스윙 4 > 단타 3
    expect([w('scalp', 'structure'), w('swing', 'structure'), w('position', 'structure')]).toEqual([3, 4, 5])
    // MACD 는 단타에서만 1점 (후행성이 커서)
    expect([w('scalp', 'macd'), w('swing', 'macd'), w('position', 'macd')]).toEqual([1, 2, 2])
    // OBV 는 장기에서 5점으로 가장 무겁다
    expect(w('position', 'obv')).toBe(5)
  })

  it('핵심 항목이 시트의 [핵심] 표시와 같다', () => {
    const core = (p: RuleProfile) => PROFILES[p].rows.filter((r) => r.core).map((r) => r.key).sort()
    expect(core('scalp')).toEqual(['fvg', 'order_block', 'structure', 'sweep'])
    expect(core('swing')).toEqual(['chart_pattern', 'fvg', 'order_block', 'structure', 'sweep'])
    expect(core('position')).toEqual(['chart_pattern', 'order_block', 'structure', 'sweep'])
  })

  it('타임프레임이 하나도 빠짐없이 프로파일에 매핑된다', () => {
    for (const tf of TIMEFRAMES) expect(PROFILE_OF[tf]).toBeDefined()
    expect(PROFILE_OF['15m']).toBe('scalp')
    expect(PROFILE_OF['1h']).toBe('swing')
    expect(PROFILE_OF['4h']).toBe('swing')
    expect(PROFILE_OF['1d']).toBe('position')
    expect(PROFILE_OF['1w']).toBe('position')
  })
})

// ── 태그 커버리지 ───────────────────────────────────────────────────────────

describe('태그 커버리지', () => {
  it('모든 taxonomy 태그가 프로파일마다 어느 행엔가 속하거나 미배점으로 선언돼 있다', () => {
    // 조용히 빠진 태그는 사용자가 정확히 짚은 근거를 룰 점수에 0으로 기여하게 만든다.
    for (const p of Object.values(PROFILES)) {
      const covered = new Set(p.rows.flatMap((r) => r.tags))
      const unscored = new Set(p.unscored)
      const missing = TAGS.map((t) => t.id).filter((id) => !covered.has(id) && !unscored.has(id))
      expect(missing, `${p.id} 프로파일에서 어느 행에도 안 걸린 태그: ${missing.join(', ')}`).toEqual([])
    }
  })

  it('미배점으로 선언한 태그는 실제로 어느 행에도 없다 — 목록이 썩지 않게', () => {
    for (const p of Object.values(PROFILES)) {
      const covered = new Set(p.rows.flatMap((r) => r.tags))
      const stale = p.unscored.filter((id) => covered.has(id))
      expect(stale, `${p.id}: 미배점 목록에 있는데 실제로는 행에 있다: ${stale.join(', ')}`).toEqual([])
    }
  })

  it('미배점 목록의 태그가 taxonomy 에 실재한다', () => {
    const known = new Set(TAGS.map((t) => t.id))
    for (const p of Object.values(PROFILES)) {
      expect(p.unscored.filter((id) => !known.has(id)), `${p.id}`).toEqual([])
    }
  })

  it('단타는 MA·OBV 행이 없어 그 근거들이 점수에 기여하지 않는다', () => {
    // 엑셀 단타 시트에 해당 행이 없다. 실수로 빠진 것이 아니라 시트 그대로다.
    expect(PROFILES.scalp.unscored).toContain('ma_aligned_bull')
    expect(PROFILES.scalp.unscored).toContain('obv_divergence')
    expect(ruleCheck([
      sig('ma_aligned_bull', 'bullish'), sig('obv_divergence', 'bullish'),
    ], '15m').score).toBe(0)
    // 같은 근거가 스윙에서는 3 + 3 = 6 점이다
    expect(ruleCheck([
      sig('ma_aligned_bull', 'bullish'), sig('obv_divergence', 'bullish'),
    ], '4h').score).toBe(6)
  })

  it('감지기가 없는 항목의 배점 합을 보고한다', () => {
    // 스윙: 차트패턴 4. 장기: 차트패턴 5.
    // Part 3 에서 피보나치 행(2점), Part 5 에서 추세선 행(2점)이 살아났다 —
    // 8 → 6 → 4 로 내려왔다. 이번에 차트패턴 16종도 추가되면서 마침내 모든 감지기가 채워졌다.
    expect(ruleCheck([], '4h').dormantWeight).toBe(0)
    expect(ruleCheck([], '1d').dormantWeight).toBe(0)
    expect(ruleCheck([], '15m').dormantWeight).toBe(0)
  })
})

// ── 항목 상태 ───────────────────────────────────────────────────────────────

describe('항목 상태 판정', () => {
  it('강세 신호만 있으면 강세, 배점만큼 더한다', () => {
    const r = ruleCheck([sig('liq_sweep_low', 'bullish')], '4h')
    expect(rowOf(r, 'sweep').state).toBe('bullish')
    expect(rowOf(r, 'sweep').points).toBe(4)
  })

  it('약세면 배점만큼 뺀다', () => {
    const r = ruleCheck([sig('liq_sweep_high', 'bearish')], '4h')
    expect(rowOf(r, 'sweep').points).toBe(-4)
  })

  it('한 항목 안에서 방향이 엇갈리면 중립이다 — 임의로 한쪽을 고르지 않는다', () => {
    const r = ruleCheck([sig('liq_sweep_low', 'bullish'), sig('liq_sweep_high', 'bearish')], '4h')
    expect(rowOf(r, 'sweep').state).toBe('neutral')
    expect(rowOf(r, 'sweep').points).toBe(0)
  })

  it('신호가 없으면 중립이다', () => {
    expect(rowOf(ruleCheck([], '4h'), 'sweep').state).toBe('neutral')
  })

  it('같은 항목의 신호가 여러 개여도 배점은 한 번만 매긴다', () => {
    // 엑셀은 항목당 상태를 하나 고르는 구조다. 신호 개수로 점수가 불어나면 안 된다.
    const one = ruleCheck([sig('ob_bull_support', 'bullish', 100)], '4h')
    const many = ruleCheck([
      sig('ob_bull_support', 'bullish', 100),
      sig('ob_bull_support', 'bullish', 101),
      sig('ob_bull_support', 'bullish', 102),
    ], '4h')
    expect(rowOf(many, 'order_block').points).toBe(rowOf(one, 'order_block').points)
    expect(rowOf(many, 'order_block').points).toBe(3)
  })

  it('side 가 중립인 신호는 어느 쪽으로도 세지 않는다', () => {
    const r = ruleCheck([sig('trend_range', 'neutral')], '4h')
    expect(rowOf(r, 'structure').state).toBe('neutral')
  })
})

// ── 시너지 ──────────────────────────────────────────────────────────────────

describe('시너지 보너스', () => {
  it('스윙: 같은 봉·같은 방향의 스윕+오더블록이면 골든 콤보', () => {
    const r = ruleCheck([
      sig('liq_sweep_low', 'bullish', 100),
      sig('ob_bull_support', 'bullish', 100),
    ], '4h')
    expect(r.synergy.kind).toBe('golden_combo')
    expect(r.synergy.applied).toBe(true)
    expect(r.synergy.bonus).toBe(2)
    // 스윕 4 + 오더블록 3 + 보너스 2 = 9
    expect(r.score).toBe(9)
  })

  it('봉이 다르면 골든 콤보가 아니다', () => {
    const r = ruleCheck([
      sig('liq_sweep_low', 'bullish', 100),
      sig('ob_bull_support', 'bullish', 101),
    ], '4h')
    expect(r.synergy.applied).toBe(false)
    expect(r.score).toBe(7)
  })

  it('방향이 다르면 골든 콤보가 아니다', () => {
    const r = ruleCheck([
      sig('liq_sweep_low', 'bullish', 100),
      sig('ob_bear_resistance', 'bearish', 100),
    ], '4h')
    expect(r.synergy.applied).toBe(false)
  })

  it('장기는 골든 콤보가 아니라 MA Combo 다 — 스윕+오더블록으로는 안 붙는다', () => {
    const r = ruleCheck([
      sig('liq_sweep_low', 'bullish', 100),
      sig('ob_bull_support', 'bullish', 100),
    ], '1d')
    expect(r.synergy.kind).toBe('ma_combo')
    expect(r.synergy.applied).toBe(false)
  })

  it('장기: MA 배열과 추세 구조가 같은 방향이면 MA Combo', () => {
    const r = ruleCheck([
      sig('ma_aligned_bull', 'bullish'),
      sig('trend_up_structure', 'bullish'),
    ], '1d')
    expect(r.synergy.applied).toBe(true)
    // 추세구조 5 + MA배열 4 + 보너스 2 = 11
    expect(r.score).toBe(11)
  })

  it('장기: MA 배열만 있으면 MA Combo 가 아니다 — 정배열은 상승장에서 항상 붙는다', () => {
    const r = ruleCheck([sig('ma_aligned_bull', 'bullish')], '1d')
    expect(r.synergy.applied).toBe(false)
  })

  it('장기: MA 배열과 추세가 어긋나면 MA Combo 가 아니다', () => {
    const r = ruleCheck([
      sig('ma_aligned_bull', 'bullish'),
      sig('trend_down_structure', 'bearish'),
    ], '1d')
    expect(r.synergy.applied).toBe(false)
  })
})

// ── 조건락 ──────────────────────────────────────────────────────────────────

describe('조건락 — 핵심 항목이 없으면 점수가 넘어도 거부', () => {
  it('컷라인 미달이면 관망', () => {
    const r = ruleCheck([sig('liq_sweep_low', 'bullish')], '4h')
    expect(r.score).toBeLessThan(16)
    expect(r.verdict).toEqual({ kind: 'wait' })
  })

  it('컷라인을 넘고 핵심 항목도 같은 방향이면 진입', () => {
    const r = ruleCheck([
      sig('liq_sweep_low', 'bullish', 100),   // 핵심 4
      sig('ob_bull_support', 'bullish', 100), // 핵심 3 (+ 콤보 2)
      sig('trend_up_structure', 'bullish'),   // 핵심 4
      sig('vol_climax', 'bullish'),           // 4
    ], '4h')
    expect(r.score).toBeGreaterThanOrEqual(16)
    expect(r.verdict).toEqual({ kind: 'long' })
  })

  it('보조지표만으로 점수를 채우면 거부한다 — 세력의 흔적이 없는 자리다', () => {
    // 스윙 컷라인 16. 핵심(구조/SMC) 없이 보조지표만: 거래량4 + OBV3 + MA3 + 볼린저3 +
    // RSI2 + MACD2 = 17 ≥ 16 이지만 핵심 항목이 하나도 강세가 아니다.
    const r = ruleCheck([
      sig('vol_climax', 'bullish'), sig('obv_divergence', 'bullish'),
      sig('ma_aligned_bull', 'bullish'), sig('bb_break_upper', 'bullish'),
      sig('rsi_bull_div', 'bullish'), sig('macd_golden', 'bullish'),
    ], '4h')
    expect(r.score).toBeGreaterThanOrEqual(16)
    expect(r.verdict).toEqual({ kind: 'rejected', wouldHaveBeen: 'long' })
  })

  it('숏도 대칭으로 거부한다', () => {
    const r = ruleCheck([
      sig('vol_climax', 'bearish'), sig('obv_divergence', 'bearish'),
      sig('ma_aligned_bear', 'bearish'), sig('bb_break_lower', 'bearish'),
      sig('rsi_bear_div', 'bearish'), sig('macd_dead', 'bearish'),
    ], '4h')
    expect(r.score).toBeLessThanOrEqual(-16)
    expect(r.verdict).toEqual({ kind: 'rejected', wouldHaveBeen: 'short' })
  })

  it('핵심이 반대 방향으로만 충족되면 거부한다', () => {
    // 점수는 강세로 넘는데 핵심 항목은 약세뿐인 자리
    const r = ruleCheck([
      sig('ob_bear_resistance', 'bearish'),    // 핵심 약세 −3
      sig('vol_climax', 'bullish'), sig('obv_divergence', 'bullish'),
      sig('ma_aligned_bull', 'bullish'), sig('bb_break_upper', 'bullish'),
      sig('rsi_bull_div', 'bullish'), sig('macd_golden', 'bullish'),
      sig('candle_hammer', 'bullish'),
    ], '4h')
    if (r.score >= 16) {
      expect(r.verdict).toEqual({ kind: 'rejected', wouldHaveBeen: 'long' })
    }
    expect(r.rows.filter((x) => x.core && x.state === 'bullish')).toHaveLength(0)
  })

  it('컷라인 정확히 도달하면 진입이다 — 이상/이하 포함', () => {
    // 단타 컷라인 12. 스윕5(핵심) + FVG4(핵심) + 볼린저3 = 12
    const r = ruleCheck([
      sig('liq_sweep_low', 'bullish', 100),
      sig('fvg_bull', 'bullish', 100),
      sig('bb_break_upper', 'bullish'),
    ], '15m')
    expect(r.score).toBe(12)
    expect(r.verdict).toEqual({ kind: 'long' })
  })
})

// ── 프로파일 분기 ───────────────────────────────────────────────────────────

describe('같은 근거라도 프로파일마다 결과가 다르다', () => {
  const same = [
    sig('liq_sweep_low', 'bullish', 100),
    sig('ob_bull_support', 'bullish', 100),
    sig('trend_up_structure', 'bullish'),
  ]

  it('단타는 배점이 커서 같은 근거로 더 높은 점수가 나온다', () => {
    // 단타: 스윕5 + OB4 + 구조3 + 콤보2 = 14  /  스윙: 4+3+4+2 = 13
    expect(ruleCheck(same, '15m').score).toBe(14)
    expect(ruleCheck(same, '4h').score).toBe(13)
  })

  it('단타는 컷라인 12를 넘어 진입, 스윙은 16 미달로 관망이다', () => {
    expect(ruleCheck(same, '15m').verdict).toEqual({ kind: 'long' })
    expect(ruleCheck(same, '4h').verdict).toEqual({ kind: 'wait' })
  })

  it('1h 와 4h 는 같은 스윙 프로파일이라 결과가 같다', () => {
    expect(ruleCheck(same, '1h')).toEqual(ruleCheck(same, '4h'))
  })
})

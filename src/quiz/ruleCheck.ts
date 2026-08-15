import type { Timeframe } from '../data/types'
import type { SignalSide } from '../analysis/signalTypes'
import type { ActiveSignal } from './lifetime'

/**
 * 사용자의 트레이딩 가중치 체계 — 진입 판단 룰 패널.
 *
 * **주 채점(grader.ts)과 별개다.** 채점기는 "당신의 판독이 얼마나 정확했나" 를 100점으로
 * 재고, 이쪽은 "내 기준으로 이 자리가 진입인가 관망인가" 를 답한다. 설계 스펙 7.3이
 * 이 체계를 채점 주체가 아니라 별도 검증 뷰로 둔 이유가 그것이다 — 사용자 본인의
 * 진입 도구이지 정답표가 아니다.
 *
 * 출처: locked_advanced_trading_system.xlsx (2026-08-09). 시트 세 개가 각각
 * 단타/스윙/장기이고, 배점·컷라인·시너지 보너스가 전부 다르다.
 *
 * 채점기의 signalWeight 와 이 표는 **서로 다른 숫자다.** 섞지 말 것 —
 * signalWeight 는 후보 선별·핵심 근거 판정에 쓰는 내부 기계이고, 여기는 사용자의
 * 진입 룰이다. 한쪽을 고쳐도 다른 쪽은 그대로다.
 */

export type RuleProfile = 'scalp' | 'swing' | 'position'

/** 타임프레임 → 프로파일. 엑셀 시트 제목의 구간을 그대로 옮겼다 */
export const PROFILE_OF: Record<Timeframe, RuleProfile> = {
  '15m': 'scalp',   // 단타 (Scalping 1m~15m)
  '1h': 'swing',    // 스윙 (Swing 1H~4H)
  '4h': 'swing',
  '1d': 'position', // 장기 (Position 1D~1W)
  '1w': 'position',
}

/**
 * 시너지 보너스의 종류. 프로파일마다 다르다 —
 * 단타·스윙은 "유동성을 흡수한 오더블록"(골든 콤보), 장기는 "장기 정배열"이다.
 */
export type SynergyKind = 'golden_combo' | 'ma_combo'

/** 룰 패널의 한 줄. 엑셀의 "지표 항목명" 한 행에 대응한다 */
export type RuleRowDef = {
  key: string
  label: string
  /** 이 항목의 배점 */
  weight: number
  /** [핵심] 태그가 붙은 항목인가 — 조건락의 대상 */
  core: boolean
  /** 이 항목으로 집계되는 taxonomy 태그들 */
  tags: string[]
}

export type ProfileDef = {
  id: RuleProfile
  label: string
  /** 진입 컷라인. +cutline 이상이면 롱, −cutline 이하면 숏 */
  cutline: number
  synergy: SynergyKind
  synergyBonus: number
  rows: RuleRowDef[]
  /**
   * 이 프로파일에서 어느 행에도 속하지 않는 태그.
   *
   * 프로파일마다 다르다 — 단타 시트에는 MA·OBV 행이 아예 없어서 정배열과 OBV
   * 다이버전스가 단타에서는 점수에 기여하지 않는다. 조용히 빠지면 사용자가 정확히
   * 짚은 근거가 0으로 계산되므로, 빠지는 것을 여기 적어 두고 테스트로 강제한다.
   */
  unscored: string[]
}

// ── 태그 묶음 ────────────────────────────────────────────────────────────────
//
// 엑셀의 한 행은 "지표 항목" 하나이고 상태를 강세/약세/중립 중 하나로 고른다. 그래서
// 점수는 신호 개수가 아니라 **항목 단위로 한 번** 매긴다 — 오더블록이 세 개 살아 있어도
// "오더블럭" 행은 배점 한 번이다.

const SWEEP = ['liq_sweep_low', 'liq_sweep_high']
const FVG = ['fvg_bull', 'fvg_bear']
const ORDER_BLOCK = ['ob_bull_support', 'ob_bear_resistance']
const STRUCTURE = [
  'trend_up_structure', 'trend_down_structure', 'trend_range',
  'msb_bull', 'msb_bear',
]
const VOLUME = ['vol_breakout_confirm', 'vol_breakout_weak', 'vol_climax']
const BOLLINGER = ['bb_squeeze', 'bb_break_upper', 'bb_break_lower']
const RSI = [
  'rsi_overbought', 'rsi_oversold', 'rsi_50_break',
  'rsi_bull_div', 'rsi_bear_div', 'rsi_hidden_div',
]
const MACD = ['macd_golden', 'macd_dead', 'macd_zero_break', 'macd_divergence']
const CANDLE = [
  'candle_hammer', 'candle_inv_hammer', 'candle_shooting_star', 'candle_doji',
  'candle_bull_engulf', 'candle_bear_engulf', 'candle_bull_harami', 'candle_bear_harami',
  'candle_morning_star', 'candle_evening_star', 'candle_three_soldiers', 'candle_three_crows',
  'candle_tri_star', 'tweezer_top', 'tweezer_bottom', 'candle_inside_bar',
]
const WICK = ['candle_long_wick']
const OBV = ['obv_divergence']
const MA_ALIGN = ['ma_aligned_bull', 'ma_aligned_bear']

/**
 * 이동평균 크로스 — 세 프로파일 어디에도 행이 없다.
 *
 * 엑셀의 MA 행은 전부 "완벽한 정배열/역배열" 이라고 **배열만** 지목한다. 크로스는
 * 구조 변화가 끝난 뒤에 뜨는 후행 신호라 배열보다 신뢰도가 낮다는 것이 사용자의
 * 판단이었고(2026-08-06), 엑셀도 크로스 행을 따로 두지 않았다.
 */
const MA_CROSS_UNSCORED = ['ma_golden_cross', 'ma_dead_cross']

// ── 프로파일 정의 ────────────────────────────────────────────────────────────
//
// 엑셀 세 시트를 행 순서까지 그대로 옮겼다. 감지기가 없는 항목(거시 차트 패턴·추세선·
// 피보나치)은 tags 가 빈 배열이다 — 행은 남겨 두되 항상 중립으로 집계된다. 지우지 않는
// 이유는 Part 3 에서 감지기가 생기면 바로 살아나야 하고, 지금 몇 점어치가 비어 있는지
// 사람이 볼 수 있어야 하기 때문이다.

const r = (key: string, label: string, weight: number, core: boolean, tags: string[]): RuleRowDef =>
  ({ key, label, weight, core, tags })

export const PROFILES: Record<RuleProfile, ProfileDef> = {
  scalp: {
    id: 'scalp',
    label: '단타 (Scalping 1m~15m)',
    cutline: 12,
    synergy: 'golden_combo',
    synergyBonus: 2,
    rows: [
      r('sweep', '유동성 청산 (Sweep)', 5, true, SWEEP),
      r('fvg', 'FVG (Fair Value Gap)', 4, true, FVG),
      r('order_block', '일반 오더블럭 (OB)', 4, true, ORDER_BLOCK),
      r('structure', '단기 추세 구조', 3, true, STRUCTURE),
      r('volume', '거래량 (Volume)', 3, false, VOLUME),
      r('bollinger', '볼린저 밴드', 3, false, BOLLINGER),
      r('rsi', 'RSI 지표', 2, false, RSI),
      r('macd', 'MACD 지표', 1, false, MACD),
      r('candle', '캔들 패턴', 2, false, CANDLE),
      r('wick', '캔들 꼬리 (Wick)', 2, false, WICK),
    ],
    // 단타 시트에는 MA 행도 OBV 행도 없다. 1~15분봉에서 이평 배열과 누적 수급은
    // 진입 근거로 쓰지 않는다는 뜻이라, 있는 그대로 미배점으로 둔다.
    unscored: [...MA_CROSS_UNSCORED, ...MA_ALIGN, ...OBV],
  },
  swing: {
    id: 'swing',
    label: '스윙 (Swing 1H~4H)',
    cutline: 16,
    synergy: 'golden_combo',
    synergyBonus: 2,
    rows: [
      r('structure', '추세 구조 (Structure)', 4, true, STRUCTURE),
      r('sweep', '유동성 청산 (Sweep)', 4, true, SWEEP),
      r('fvg', 'FVG (Fair Value Gap)', 4, true, FVG),
      r('chart_pattern', '거시 차트 패턴', 4, true, []),   // 감지기 미구현 (Part 3)
      r('order_block', '일반 오더블럭 (OB)', 3, true, ORDER_BLOCK),
      r('volume', '거래량 (Volume)', 4, false, VOLUME),
      r('obv', 'OBV 누적 수급', 3, false, OBV),
      r('ma_align', '이동평균 배열 (MA)', 3, false, MA_ALIGN),
      r('trendline', '추세선 (Trendline)', 2, false, []),  // 감지기 미구현 (Part 3)
      r('fibonacci', '피보나치 (Fibonacci)', 2, false, []), // 감지기 미구현 (Part 3)
      r('bollinger', '볼린저 밴드', 3, false, BOLLINGER),
      r('rsi', 'RSI 지표', 2, false, RSI),
      r('macd', 'MACD 지표', 2, false, MACD),
      r('candle', '캔들 패턴', 2, false, [...CANDLE, ...WICK]),
    ],
    unscored: [...MA_CROSS_UNSCORED],
  },
  position: {
    id: 'position',
    label: '장기 (Position 1D~1W)',
    cutline: 17,
    synergy: 'ma_combo',
    synergyBonus: 2,
    rows: [
      r('structure', '거시 추세 구조', 5, true, STRUCTURE),
      r('chart_pattern', '거시 차트 패턴', 5, true, []),   // 감지기 미구현 (Part 3)
      r('order_block', '주요 오더블럭 (OB)', 4, true, ORDER_BLOCK),
      r('sweep', '유동성 청산 (Sweep)', 3, true, SWEEP),
      r('obv', 'OBV 누적 수급', 5, false, OBV),
      r('volume', '거시 거래량 (Volume)', 4, false, VOLUME),
      r('ma_align', '이동평균 배열 (MA)', 4, false, MA_ALIGN),
      r('fvg', '주봉 FVG', 3, false, FVG),
      r('bollinger', '볼린저 밴드', 3, false, BOLLINGER),
      r('rsi', 'RSI 지표', 2, false, RSI),
      r('macd', 'MACD 지표', 2, false, MACD),
      r('candle', '거시 캔들 패턴', 2, false, [...CANDLE, ...WICK]),
    ],
    unscored: [...MA_CROSS_UNSCORED],
  },
}

// ── 판정 ─────────────────────────────────────────────────────────────────────

export type RowState = 'bullish' | 'bearish' | 'neutral'

export type RuleRowResult = {
  key: string
  label: string
  weight: number
  core: boolean
  state: RowState
  /** 부호 있는 기여분. 중립이면 0 */
  points: number
  /** 이 행을 그 상태로 만든 태그들 */
  matched: string[]
}

export type TradeVerdict =
  /** 컷라인을 넘고 조건락도 통과 */
  | { kind: 'long' }
  | { kind: 'short' }
  /** 컷라인 미달 */
  | { kind: 'wait' }
  /** 점수는 넘었으나 핵심 항목이 같은 방향으로 하나도 충족되지 않음 */
  | { kind: 'rejected'; wouldHaveBeen: 'long' | 'short' }

export type RuleCheckResult = {
  profile: RuleProfile
  label: string
  cutline: number
  rows: RuleRowResult[]
  synergy: { kind: SynergyKind; label: string; applied: boolean; side: RowState; bonus: number }
  /** 행 점수 합 + 시너지 */
  score: number
  verdict: TradeVerdict
  /** 감지기가 없어 항상 중립인 항목들의 배점 합 — 지금 몇 점이 잠들어 있는지 */
  dormantWeight: number
}

/**
 * 한 항목의 상태.
 *
 * 강세 신호만 있으면 강세, 약세만 있으면 약세, **둘 다 있거나 없으면 중립**이다.
 * 엑셀의 "현재 상태 선택(강세/약세/중립)" 을 자동으로 채우는 것이라, 한 항목 안에서
 * 방향이 엇갈리면 그 항목은 근거로 쓸 수 없다고 본다 — 상충을 0으로 접는 편이
 * 한쪽을 임의로 고르는 것보다 정직하다.
 *
 * trend_range 처럼 side 가 neutral 인 신호는 어느 쪽으로도 세지 않는다.
 */
function rowState(active: ActiveSignal[], tags: string[]): { state: RowState; matched: string[] } {
  const inRow = active.filter((s) => tags.includes(s.id))
  if (inRow.length === 0) return { state: 'neutral', matched: [] }

  const sides = new Set<SignalSide>(inRow.map((s) => s.side))
  const bull = sides.has('bullish')
  const bear = sides.has('bearish')
  if (bull === bear) return { state: 'neutral', matched: inRow.map((s) => s.id) }

  const side: RowState = bull ? 'bullish' : 'bearish'
  return { state: side, matched: inRow.filter((s) => s.side === side).map((s) => s.id) }
}

/** 같은 봉에서 같은 방향의 스윕과 오더블록 — 유동성을 흡수한 오더블록 */
function goldenComboSide(active: ActiveSignal[]): RowState {
  const sweeps = active.filter((s) => SWEEP.includes(s.id))
  const blocks = active.filter((s) => ORDER_BLOCK.includes(s.id))
  for (const sw of sweeps) {
    for (const ob of blocks) {
      if (sw.side !== ob.side) continue
      if (sw.barIndex !== ob.barIndex) continue
      return sw.side === 'bullish' ? 'bullish' : 'bearish'
    }
  }
  return 'neutral'
}

/**
 * 장기 정배열 — 이동평균 배열과 추세 구조가 같은 방향.
 *
 * 엑셀은 "주봉/월봉 50/200 완벽한 정배열 안착" 이라고 적고 있다. 배열 하나만 보면
 * 상승장에서 거의 항상 붙어 시너지 보너스가 아니게 되므로, 대세 추세와 같은 방향일
 * 것을 함께 요구한다 — "안착" 은 배열이 추세와 어긋나지 않는 상태를 말한다.
 */
function maComboSide(active: ActiveSignal[]): RowState {
  const align = rowState(active, MA_ALIGN).state
  if (align === 'neutral') return 'neutral'
  const structure = rowState(active, ['trend_up_structure', 'trend_down_structure']).state
  return structure === align ? align : 'neutral'
}

/**
 * 룰 패널 판정.
 *
 * **조건락**: 점수가 컷라인을 넘어도 [핵심] 항목 중 최소 하나가 같은 방향으로 충족돼야
 * 진입이다. 구조 근거 없이 보조지표만으로 점수를 채운 자리를 걸러내기 위한 장치다 —
 * 그런 자리는 점수가 높아도 세력의 흔적이 없다.
 */
export function ruleCheck(active: ActiveSignal[], tf: Timeframe): RuleCheckResult {
  const profile = PROFILES[PROFILE_OF[tf]]

  const rows: RuleRowResult[] = profile.rows.map((def) => {
    const { state, matched } = rowState(active, def.tags)
    const points = state === 'bullish' ? def.weight : state === 'bearish' ? -def.weight : 0
    return { key: def.key, label: def.label, weight: def.weight, core: def.core, state, points, matched }
  })

  const synergySide = profile.synergy === 'golden_combo'
    ? goldenComboSide(active)
    : maComboSide(active)
  const synergyPoints = synergySide === 'bullish' ? profile.synergyBonus
    : synergySide === 'bearish' ? -profile.synergyBonus
    : 0

  const score = rows.reduce((sum, x) => sum + x.points, 0) + synergyPoints

  // 조건락 — 핵심 항목이 같은 방향으로 하나라도 충족됐는가
  const coreSide = (side: RowState) => rows.some((x) => x.core && x.state === side)

  let verdict: TradeVerdict
  if (score >= profile.cutline) {
    verdict = coreSide('bullish') ? { kind: 'long' } : { kind: 'rejected', wouldHaveBeen: 'long' }
  } else if (score <= -profile.cutline) {
    verdict = coreSide('bearish') ? { kind: 'short' } : { kind: 'rejected', wouldHaveBeen: 'short' }
  } else {
    verdict = { kind: 'wait' }
  }

  return {
    profile: profile.id,
    label: profile.label,
    cutline: profile.cutline,
    rows,
    synergy: {
      kind: profile.synergy,
      label: profile.synergy === 'golden_combo' ? '골든 콤보 (Sweep+OB)' : '장기 정배열 (MA Combo)',
      applied: synergySide !== 'neutral',
      side: synergySide,
      bonus: synergyPoints,
    },
    score,
    verdict,
    dormantWeight: profile.rows.filter((d) => d.tags.length === 0).reduce((s, d) => s + d.weight, 0),
  }
}

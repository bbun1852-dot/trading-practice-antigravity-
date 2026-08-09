import type { Tier, SignalKind, Confidence } from '../analysis/signalTypes'

export type LifetimeClass =
  | { kind: 'bar' }
  | { kind: 'recent'; bars: number }
  | { kind: 'zone'; maxBars: number; invalidateOn: 'touch' | 'close_through' }
  // group: 같은 그룹 안에서는 id가 달라도 최신 1개만 남는다 (상호배타적 값들을
  // 서로 다른 id로 나눈 감지기를 위한 것 — 예: trend_up/down/range).
  | { kind: 'state'; group: string }

export type TagDef = {
  id: string
  label: string
  /** 감지기가 배출한 tier 값 그대로. 채점 배점은 tier 가 아니라 weight 가 정한다 */
  tier: Tier
  kind: SignalKind
  confidence: Confidence
  lifetime: LifetimeClass
  /** 채점 배점. 아래 WEIGHT 표가 원천이다 */
  weight: number
}

// ── 배점: 사용자의 트레이딩 노트 가중치 체계 (2026-08-06 개정) ────────────────
//
// 배점 권위가 `signalTypes.ts` 의 TIER_WEIGHT 에서 이 표로 옮겨왔다. 이유는 하나다 —
// 개정된 체계에서 유동성 청산은 4점이고 오더블록은 3점인데, 감지기는 둘 다
// `tier: 1` 로 배출한다. tier 하나로는 두 배점을 구분할 수 없고, tier 를 고치려면
// Part 1 감지기를 건드려야 한다(동결 영역). 태그 단위 배점으로 옮기면 감지기를
// 한 줄도 안 건드리고 표를 그대로 옮길 수 있다.
//
// 오더블록이 5점에서 3점으로 내려온 것이 이번 개정의 핵심이다. 뒤에 미청산 물량이
// 남은 오더블록은 세력이 지켜주지 않고 뚫어버린 뒤 아래 유동성을 먹고 올리는 자리라,
// 단독 신뢰도가 그만큼 높지 않다. 대신 유동성을 털어내며 만들어진 오더블록에는
// 골든 콤보 가산(+2)이 붙어 4+3+2 = 9점이 된다 (scanner.ts 의 GOLDEN_COMBO_BONUS).
const WEIGHT: Record<string, number> = {
  // Tier 1 (4점) — 시장 구조 & 핵심
  liq_sweep_low: 4, liq_sweep_high: 4,
  fvg_bull: 4, fvg_bear: 4,
  vol_breakout_confirm: 4, vol_breakout_weak: 4, vol_climax: 4,

  // Tier 2 (3점) — 수급 & 기하학적 분석
  ob_bull_support: 3, ob_bear_resistance: 3,
  obv_divergence: 3,
  trend_up_structure: 3, trend_down_structure: 3, trend_range: 3,
  bb_squeeze: 3, bb_break_upper: 3, bb_break_lower: 3,
  // 이동평균은 크로스와 배열을 나눈다. 크로스는 구조 변화가 끝난 뒤에 뒤늦게 뜨는
  // 후행 신호지만, 배열은 현재 추세의 밀도와 관성을 보여주므로 신뢰도가 더 높다.
  ma_aligned_bull: 3, ma_aligned_bear: 3,

  // Tier 3 (2점) — 모멘텀 & 캔들 신호
  msb_bull: 2, msb_bear: 2,
  ma_golden_cross: 2, ma_dead_cross: 2,
  macd_golden: 2, macd_dead: 2, macd_zero_break: 2, macd_divergence: 2,
  rsi_overbought: 2, rsi_oversold: 2, rsi_50_break: 2,
  rsi_bull_div: 2, rsi_bear_div: 2, rsi_hidden_div: 2,
  candle_hammer: 2, candle_inv_hammer: 2, candle_shooting_star: 2, candle_doji: 2,
  candle_bull_engulf: 2, candle_bear_engulf: 2, candle_bull_harami: 2,
  candle_bear_harami: 2, candle_morning_star: 2, candle_evening_star: 2,
  candle_three_soldiers: 2, candle_three_crows: 2, candle_tri_star: 2,
  tweezer_top: 2, tweezer_bottom: 2, candle_long_wick: 2, candle_inside_bar: 2,
}

// ── 수명 값: Task 5에서 scripts/calibrate.ts 로 실측 확정 ──────────────────────
//
// 측정: BTC/ETH/SOL/XRP/LINK × 4h/1d, 2026-08-01T00:00Z 까지 1000봉(창 고정),
// 계열당 결정 시점 40개 = 표본 400개.
//
// recent 를 한 값으로 두지 않고 두 단으로 나눈다. 스펙 3.2가 태그별로 다른 값을
// 허용하는 이유가 여기 있다 — "근거가 아직 살아있다" 의 뜻이 사건 종류마다 다르다.
//
//   구조·SMC 사건(스윕/MSB/FVG)은 차트에 자리(레벨)를 남긴다. 14봉 뒤에도
//   "저기서 유동성을 털었다" 는 여전히 짚을 만한 근거다.
//   지표의 순간 사건(RSI 70선 돌파, 다이버전스, 거래량 급증)은 그 순간의 사건이라
//   4봉이 지나면 근거로 대기 민망하다.
//
// recent 를 전 태그 한 값으로 두면 목표 대역(8~15) 안에 드는 결정 시점이 최대
// 79%였는데, 두 단으로 나누니 81.5%(400개 중 326개)가 됐다. 동시에 ob_* 두 태그의
// 비중이 41% → 33.5% 로 내려갔다 — zone 값을 건드려서가 아니라 다른 근거가 늘어난
// 결과다.
//
// 확정값에서의 실측(2026-08-06 측정): 계열별 중앙값 10.0~12.0 — 10개 계열 전부
// 8~15 통과. 풀링 분포 최소 2 / p25 9 / 중앙 11 / p75 13 / 최대 22.
// 49종 중 한 번도 유효하지 않은 태그는 0종이다.
const RECENT_STRUCTURAL = 14
const RECENT_MOMENTARY = 4
const ZONE_MAX_BARS = 50

const bar = (): LifetimeClass => ({ kind: 'bar' })
const recent = (bars: number): LifetimeClass => ({ kind: 'recent', bars })
const state = (group: string): LifetimeClass => ({ kind: 'state', group })
const zone = (maxBars: number, invalidateOn: 'touch' | 'close_through'): LifetimeClass =>
  ({ kind: 'zone', maxBars, invalidateOn })

const t = (
  id: string, label: string, tier: Tier, kind: SignalKind, lifetime: LifetimeClass,
  confidence: Confidence = 'A',
): TagDef => {
  const weight = WEIGHT[id]
  // 모듈 로드 시점에 터뜨린다. 배점 없는 태그를 0점으로 흘려보내면 사용자가 정확히
  // 짚은 근거가 조용히 무득점 처리되고, 테스트가 돌기 전에는 아무도 모른다.
  if (weight === undefined) throw new Error(`taxonomy: '${id}' 에 배점(WEIGHT)이 없다`)
  return { id, label, tier, kind, confidence, lifetime, weight }
}

/**
 * 감지기가 실제로 배출하는 태그만 올린다. 감지기 없는 태그를 노출하면
 * 사용자가 체크하는 족족 확정 ❌ 가 된다 (인계문서 2절).
 */
export const TAGS: TagDef[] = [
  // ── Tier 1 ──
  t('liq_sweep_low', '저점 유동성 스윕 (롱 손절 사냥)', 1, 'smc', recent(RECENT_STRUCTURAL)),
  t('liq_sweep_high', '고점 유동성 스윕 (숏 손절 사냥)', 1, 'smc', recent(RECENT_STRUCTURAL)),
  t('ob_bull_support', '강세 오더블록 지지', 1, 'smc', zone(ZONE_MAX_BARS, 'close_through')),
  t('ob_bear_resistance', '약세 오더블록 저항', 1, 'smc', zone(ZONE_MAX_BARS, 'close_through')),
  t('msb_bull', '시장구조 상향 돌파 (BOS/MSB)', 1, 'structure', recent(RECENT_STRUCTURAL)),
  t('msb_bear', '시장구조 하향 붕괴', 1, 'structure', recent(RECENT_STRUCTURAL)),

  // ── Tier 2 ──
  // FVG는 detectFVG가 이미 미충족만 배출하므로 zone이 아니라 recent다 (스펙 2.3)
  t('fvg_bull', '상승 FVG (미충족)', 2, 'smc', recent(RECENT_STRUCTURAL)),
  t('fvg_bear', '하락 FVG (미충족)', 2, 'smc', recent(RECENT_STRUCTURAL)),
  t('vol_breakout_confirm', '돌파 시 거래량 급증', 2, 'volume', recent(RECENT_MOMENTARY)),
  t('vol_breakout_weak', '거래량 없는 돌파 (트랩)', 2, 'volume', recent(RECENT_MOMENTARY)),
  t('vol_climax', '거래량 클라이맥스', 2, 'volume', recent(RECENT_MOMENTARY)),

  // ── Tier 3 ──
  // trend_up/down/range 는 한 변수의 상호배타적 세 값이므로 같은 group('trend')로
  // 묶는다 — 그래야 세 id 가 동시에 답안지에 남는 일이 없다 (Task 4 리뷰 finding 2).
  t('trend_up_structure', '상승 구조 (HH/HL)', 3, 'structure', state('trend')),
  t('trend_down_structure', '하락 구조 (LH/LL)', 3, 'structure', state('trend')),
  t('trend_range', '횡보 레인지', 3, 'structure', state('trend')),
  // bb_squeeze 는 매봉 재평가되는 조건이다 (indicatorSignals.ts:60 — 밴드폭이 최근
  // 60봉 최저일 때마다 발화) — "그 봉에서만 유효"가 정확하다.
  t('bb_squeeze', '볼린저 스퀴즈', 3, 'volatility', bar()),
  t('bb_break_upper', '볼린저 상단 돌파', 3, 'volatility', bar()),
  t('bb_break_lower', '볼린저 하단 이탈', 3, 'volatility', bar()),

  // ── Tier 4: 캔들패턴 17종 ──
  t('candle_hammer', '해머', 4, 'candle', bar()),
  t('candle_inv_hammer', '역해머', 4, 'candle', bar()),
  t('candle_shooting_star', '유성형', 4, 'candle', bar()),
  t('candle_doji', '도지', 4, 'candle', bar()),
  t('candle_bull_engulf', '강세 장악형', 4, 'candle', bar()),
  t('candle_bear_engulf', '약세 장악형', 4, 'candle', bar()),
  t('candle_bull_harami', '강세 하라미', 4, 'candle', bar()),
  t('candle_bear_harami', '약세 하라미', 4, 'candle', bar()),
  t('candle_morning_star', '샛별형', 4, 'candle', bar()),
  t('candle_evening_star', '석별형', 4, 'candle', bar()),
  t('candle_three_soldiers', '적삼병', 4, 'candle', bar()),
  t('candle_three_crows', '흑삼병', 4, 'candle', bar()),
  t('candle_tri_star', '트라이스타', 4, 'candle', bar()),
  t('tweezer_top', '트위저 탑', 4, 'candle', bar()),
  t('tweezer_bottom', '트위저 바텀', 4, 'candle', bar()),
  t('candle_long_wick', '긴 꼬리', 4, 'candle', bar()),
  t('candle_inside_bar', '인사이드 바', 4, 'candle', bar()),

  // ── Tier 4: 지표 ──
  // ma_aligned_* 는 매봉 재평가되는 조건이다 (indicatorSignals.ts:46-47 — EMA
  // 20/50/200 정렬을 매봉 다시 검사) — bb_squeeze 와 같은 이유로 bar 다.
  t('ma_aligned_bull', '이동평균 정배열', 4, 'ma', bar()),
  t('ma_aligned_bear', '이동평균 역배열', 4, 'ma', bar()),
  t('ma_golden_cross', '골든크로스', 4, 'ma', bar()),
  t('ma_dead_cross', '데드크로스', 4, 'ma', bar()),
  t('macd_golden', 'MACD 골든크로스', 4, 'momentum', bar()),
  t('macd_dead', 'MACD 데드크로스', 4, 'momentum', bar()),
  t('macd_zero_break', 'MACD 0선 돌파', 4, 'momentum', bar()),
  t('macd_divergence', 'MACD 다이버전스', 4, 'momentum', recent(RECENT_MOMENTARY)),
  // rsi_overbought/oversold 는 70/30 선을 "처음 넘는" 엣지에서만 발화한다
  // (indicatorSignals.ts:32-33) — 영구 상태가 아니라 만료되는 근거다.
  t('rsi_overbought', 'RSI 과매수', 4, 'momentum', recent(RECENT_MOMENTARY)),
  t('rsi_oversold', 'RSI 과매도', 4, 'momentum', recent(RECENT_MOMENTARY)),
  t('rsi_50_break', 'RSI 50선 돌파', 4, 'momentum', bar()),
  t('rsi_bull_div', 'RSI 강세 다이버전스', 4, 'momentum', recent(RECENT_MOMENTARY)),
  t('rsi_bear_div', 'RSI 약세 다이버전스', 4, 'momentum', recent(RECENT_MOMENTARY)),
  t('rsi_hidden_div', 'RSI 히든 다이버전스', 4, 'momentum', recent(RECENT_MOMENTARY)),
  t('obv_divergence', 'OBV 다이버전스', 4, 'volume', recent(RECENT_MOMENTARY)),
]

export const TAG_BY_ID = new Map(TAGS.map((d) => [d.id, d]))

/**
 * 신호 하나의 채점 무게 = 태그 배점 × 강도.
 *
 * taxonomy 에 없는 id 는 0 이다. 그런 신호는 lifetime 필터가 이미 걸러내므로
 * 채점 경로에 도달하지 않지만, 0 을 돌려주는 편이 조용히 NaN 을 퍼뜨리는 것보다 낫다.
 */
export function signalWeight(s: { id: string; strength: number }): number {
  return (TAG_BY_ID.get(s.id)?.weight ?? 0) * s.strength
}

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
  // Part 3 신규. 스펙 6.3 이 피보를 "기하학적 분석" 으로, 6.1 이 매물대를 수급으로
  // 분류하므로 둘 다 이 3점 그룹이다. 전체 설계 스펙은 volume_node_* 를 Tier 1(원래
  // 체계 5점)에 뒀지만, 개정 체계에서 Tier 1 자리는 유동성 청산(4점)이고 오더블록조차
  // 3점으로 내려왔다 — 매물대를 유동성 청산과 같은 급으로 올릴 근거가 노트에 없다.
  volume_node_high: 3, volume_node_low: 3,
  fib_retrace_382: 3, fib_retrace_5: 3, fib_retrace_618: 3,
  fib_extension: 3, fib_confluence: 3,

  // Part 4 신규 15종. 그룹은 위 표를 그대로 따른다 — 4점은 구조·유동성·FVG·거래량,
  // 3점은 수급·기하, 2점은 모멘텀이다.
  /**
   * **choch 만 2점이다 — 구조 붕괴가 아니라 그 붕괴에 붙는 수식어이기 때문이다.**
   *
   * 실측(2026-08-10, 심볼 5종 × 4h/1d): choch 248회 중 243회(98.0%)가 msb_* 와
   * 같은 봉에서 났다. 개념상 당연하다 — SMC 에서 BOS 와 CHoCH 는 같은 붕괴에 붙는
   * 상호배타적 라벨(연속이냐 반전이냐)인데, detectMSB 가 모든 붕괴를 이미 MSB 로
   * 라벨링하므로 choch 는 그 위에 얹히는 두 번째 라벨이 된다.
   *
   * 4점으로 두면 한 번의 구조 붕괴가 choch(4) + msb_*(2) = 6점을 받아, 가장 흔한
   * 구조 사건에서 점수가 부푼다. 2점이면 합이 4점이 되어 "구조가 깨졌고 그것이
   * 추세를 거슬렀다" 에 걸맞다.
   *
   * 같은 봉의 msb_* 를 억제하는 방식도 검토했으나 그러면 choch 가 10계열 통틀어
   * 5회만 남아 사실상 죽는다 — 독립적인 신호가 거의 없다는 것이 실측 결론이다.
   * 제대로 가르려면 detectMSB 를 BOS/CHoCH 로 갈라 내야 하고, 그건 Part 1 감지기를
   * 건드리는 별도 파트다.
   */
  choch: 2,
  sr_flip: 4, retest_success: 4, retest_fail: 4,
  liq_pool_untapped: 4, fvg_rebalance: 4,
  vol_divergence: 4, vol_absorption: 4,
  // 오더블록 계열이므로 오더블록과 같은 3점이다. 단독 오더블록보다 강한 흔적이지만
  // 그 차이는 strength(3) 로 표현되지 배점으로 표현되지 않는다.
  ob_double_engulfing: 3,
  bb_walking: 3, obv_trend_confirm: 3,
  // Part 5. 기하 작도 계열이므로 "수급 & 기하학적 분석" 3점 그룹이다.
  trendline_support: 3, trendline_resistance: 3, trendline_break: 3,
  channel_upper: 3, channel_lower: 3,
  rsi_failure_swing: 2, macd_hist_turn: 2, ma_support: 2, ma_resistance: 2,

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
// **2026-08-10 (Part 4) 재확정: 14 → 10.** 태그가 56 → 71종이 되며 구조 계열에만
// choch·sr_flip·retest_*·liq_pool_untapped 다섯이 더해졌고, 유효 근거 중앙값이
// 12.5 → 18 로 대역(8~15)을 벗어났다. "구조 사건은 레벨을 남기므로 오래 짚을 만하다"
// 는 성질은 그대로지만, 그런 사건 자체가 늘었으므로 한 사건이 머무는 시간을 줄이는
// 것이 대역을 지키는 방법이다. 값을 바꾸면 calibrate 를 반드시 다시 돌려야 한다.
// Part 5 에서 10 → 8. 이 수명을 쓰는 태그가 Part 3 의 5종에서 9종(스윕 2·MSB 2·
// sr_flip·retest 2·choch·liq_pool)으로 늘었다. 한 클래스에 태그가 몰릴수록 그 클래스의
// 수명이 전체 근거량을 좌우한다.
const RECENT_STRUCTURAL = 8
const RECENT_MOMENTARY = 4
// **2026-08-10 (Part 4) 재확정: 50 → 35.** RECENT_STRUCTURAL 과 같은 이유다. 태그가
// 71종이 되자 오더블록 2종이 유효 근거의 23%(1484/6398)로 최대 기여자가 됐다 — 수명이
// zone(50) 이라 한 자리가 오래 겹쳐 산다. 50 은 태그 49종 시절에 정한 값이고, 근거가
// 늘어난 지금은 한 자리가 머무는 시간을 줄이는 것이 대역을 지키는 방법이다.
// Part 5 에서 30 → 25. 태그가 76종이 되며 오더블록 2종이 여전히 최대 기여자(17.2%)라
// 계열 2개가 근거 대역을 벗어났다. 파트마다 태그가 늘 때 이 값을 다시 재는 것이
// 이제 정착된 절차다 (50 → 35 → 30 → 25).
const ZONE_MAX_BARS = 25
/**
 * 자석 효과의 수명. 오더블록보다 훨씬 짧다 — 오더블록은 "거기 물량이 있다" 는 사실이라
 * 오래 가지만, 리밸런스는 "지금 그쪽으로 가고 있다" 는 진행 상태라 금방 낡는다.
 * 15봉 안에 닿지 않았으면 그 접근은 무산된 것으로 본다.
 */
const REBALANCE_MAX_BARS = 15

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
  // **매봉 재평가되는 조건이다** — detectVolumeNodes 가 봉마다 창 120봉으로 프로파일을
  // 다시 만들고 "현재 봉이 노드에 닿았는가" 를 다시 묻는다. bb_squeeze·ma_aligned_* 와
  // 정확히 같은 성격이라 같은 수명을 준다.
  //
  // 처음에 zone(50) 으로 뒀다가 실측하고 되돌렸다(2026-08-09). 매봉 발화하는 신호에
  // zone(50) 을 주면 같은 자리가 50겹으로 쌓여서, 유효 근거 중앙값이 11 → 42 로
  // 폭증하고 계열 10/10 이 전부 8~15 게이트를 실패했다.
  t('volume_node_high', '매물대 (고거래량 노드)', 1, 'volume', bar()),
  t('volume_node_low', '매물대 공백 (저거래량 노드)', 1, 'volume', bar()),

  // ── Tier 1: 구조·유동성 (Part 4) ──
  t('choch', 'CHoCH (성격 전환)', 1, 'structure', recent(RECENT_STRUCTURAL)),
  t('sr_flip', 'S/R 플립 (저항↔지지 전환)', 1, 'structure', recent(RECENT_STRUCTURAL)),
  t('retest_success', '리테스트 성공', 1, 'structure', recent(RECENT_STRUCTURAL)),
  t('retest_fail', '리테스트 실패 (페이크아웃)', 1, 'structure', recent(RECENT_STRUCTURAL)),
  t('liq_pool_untapped', '미체결 유동성 구간 존재', 1, 'smc', recent(RECENT_STRUCTURAL)),
  /**
   * 구간이 아니라 **성질 표시**라 zone 이 아니다.
   *
   * 처음엔 오더블록과 같은 zone(30) 을 줬는데, 이 태그는 언제나 ob_bull_support /
   * ob_bear_resistance 와 같은 봉에서 함께 난다(같은 오더블록을 가리키므로 당연하다).
   * 구간을 두 태그가 나란히 들고 있으면 같은 자리가 두 겹으로 쌓여 유효 근거가
   * 부푼다 — 구간은 ob_* 가 들고, 이쪽은 "그 오더블록이 이중장악이었다" 는 사실만
   * 짧게 남긴다.
   */
  t('ob_double_engulfing', '이중장악형 오더블록', 1, 'smc', recent(RECENT_MOMENTARY)),

  // ── Tier 2 ──
  // FVG는 detectFVG가 이미 미충족만 배출하므로 zone이 아니라 recent다 (스펙 2.3)
  t('fvg_bull', '상승 FVG (미충족)', 2, 'smc', recent(RECENT_STRUCTURAL)),
  t('fvg_bear', '하락 FVG (미충족)', 2, 'smc', recent(RECENT_STRUCTURAL)),
  t('vol_breakout_confirm', '돌파 시 거래량 급증', 2, 'volume', recent(RECENT_MOMENTARY)),
  t('vol_breakout_weak', '거래량 없는 돌파 (트랩)', 2, 'volume', recent(RECENT_MOMENTARY)),
  t('vol_climax', '거래량 클라이맥스', 2, 'volume', recent(RECENT_MOMENTARY)),
  t('vol_divergence', '거래량 다이버전스 (힘없는 돌파)', 2, 'volume', recent(RECENT_MOMENTARY)),
  t('vol_absorption', '흡수 (대량 거래에도 안 밀림)', 2, 'volume', recent(RECENT_MOMENTARY)),
  /**
   * **`'touch'` 무효화 분기의 첫 소비자다.** Part 2 설계 스펙 §170 이 이 태그를 위해
   * 그 분기를 미리 구현해 뒀다고 적었고, Part 3 까지 도달 불가로 남아 있었다.
   * 자석 효과는 가격이 갭에 닿는 순간 끝나므로 touch 가 정확한 의미다.
   */
  t('fvg_rebalance', 'FVG 리밸런스 진행 중 (자석)', 2, 'smc', zone(REBALANCE_MAX_BARS, 'touch')),

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
  // 런이 3봉에 도달한 봉에서만 나는 사건이라 bar 가 아니라 recent 다.
  t('bb_walking', '볼린저 밴드 타기', 3, 'volatility', recent(RECENT_MOMENTARY)),

  // ── Tier 3: 추세선·채널 (Part 5) — **첫 B등급 태그** ──
  //
  // 추세선은 작도 기준에 따라 답이 달라진다: 어느 피벗을 잇느냐, 꼬리를 쓰느냐
  // 종가를 쓰느냐에 따라 선이 움직이고 사람마다 다르게 긋는다. 엔진이 그은 선과
  // 사용자가 그은 선이 다를 수 있으므로 헛다리 감점을 절반만 적용한다(스펙 6.7).
  // 여기가 grader.ts 의 CONFIDENCE_FACTOR.B 를 처음으로 실제로 쓰는 자리다 —
  // Part 2 에서 만들어 두고 Part 4 까지 한 번도 실행되지 않았다.
  t('trendline_support', '상승 추세선 지지', 3, 'pattern', recent(RECENT_MOMENTARY), 'B'),
  t('trendline_resistance', '하락 추세선 저항', 3, 'pattern', recent(RECENT_MOMENTARY), 'B'),
  // 이탈도 순간 사건으로 둔다. 처음엔 "구조 사건이라 오래 짚을 만하다" 며
  // recent(10) 을 줬는데, 이탈은 그 선을 죽이므로 뒤이어 다시 짚을 대상이 없다 —
  // 오래 남겨 둘 이유가 없고 실측에서도 계열 2개가 근거 대역을 벗어났다.
  t('trendline_break', '추세선 이탈', 3, 'pattern', recent(RECENT_MOMENTARY), 'B'),
  t('channel_upper', '채널 상단', 3, 'pattern', recent(RECENT_MOMENTARY), 'B'),
  t('channel_lower', '채널 하단', 3, 'pattern', recent(RECENT_MOMENTARY), 'B'),

  // ── Tier 3: 피보나치 (Part 3) ──
  // 되돌림·확장 터치는 그 순간의 사건이다 — 지표의 순간 사건과 같은 눈금을 쓴다.
  t('fib_retrace_382', '피보 되돌림 38.2%', 3, 'fib', recent(RECENT_MOMENTARY)),
  t('fib_retrace_5', '피보 되돌림 50%', 3, 'fib', recent(RECENT_MOMENTARY)),
  t('fib_retrace_618', '피보 되돌림 61.8% (골든 포켓)', 3, 'fib', recent(RECENT_MOMENTARY)),
  t('fib_extension', '피보 확장 목표 도달', 3, 'fib', recent(RECENT_MOMENTARY)),
  // 중첩도 되돌림 "터치" 라는 같은 사건이다. 처음엔 "수급 구간과 겹친 자리라 오래 짚을
  // 만하다" 며 recent(14) 로 뒀는데, 실측하니 혼자서 전체 유효 근거의 17.4%(1153/6608)를
  // 먹었다 — 다른 피보 터치(recent(4))의 5배다. 수명만 3.5배로 준 것에 근거가 없었다.
  t('fib_confluence', '피보 + 오더블록/FVG 중첩', 3, 'fib', recent(RECENT_MOMENTARY)),

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

  // ── Tier 4: 지표 (Part 4) ──
  t('rsi_failure_swing', 'RSI 페일러 스윙', 4, 'momentum', recent(RECENT_MOMENTARY)),
  t('macd_hist_turn', 'MACD 히스토그램 방향 전환', 4, 'momentum', recent(RECENT_MOMENTARY)),
  t('ma_support', '이동평균 지지 (EMA50)', 4, 'ma', recent(RECENT_MOMENTARY)),
  t('ma_resistance', '이동평균 저항 (EMA50)', 4, 'ma', recent(RECENT_MOMENTARY)),
  // "종가와 OBV 가 동시에 창의 극값인가" 는 매봉 재평가되는 조건이다 —
  // bb_squeeze·ma_aligned_*·volume_node_* 와 같은 성격이라 같은 수명을 준다.
  t('obv_trend_confirm', 'OBV 추세 확인', 4, 'volume', bar()),
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

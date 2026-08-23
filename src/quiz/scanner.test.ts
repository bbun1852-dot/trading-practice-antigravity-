import { describe, it, expect } from 'vitest'
import {
  setupScore, dominantSide, difficultyOf, mergeCandidates, scanForSetups,
  hasGoldenCombo, GOLDEN_COMBO_BARS, GOLDEN_COMBO_BONUS,
  WARMUP, DEFAULT_MIN_SCORE, DEFAULT_MERGE_WINDOW, COARSE_SLACK,
} from './scanner'
import { TAG_BY_ID, signalWeight } from './taxonomy'
import { activeSignalsAt, filterActive } from './lifetime'
import { detectAll } from '../analysis/signals'
import type { Signal } from '../analysis/signalTypes'
import type { SetupCandidate } from './types'
import { synthCandles } from '../analysis/fixtures'

/**
 * 실제 taxonomy 태그로만 신호를 만든다.
 *
 * 배점이 태그 id 에서 오기 때문에(taxonomy.ts 의 WEIGHT) 가짜 id 를 쓰면 무게가 0 이
 * 되어 테스트가 조용히 무의미해진다. 없는 id 는 여기서 즉시 터뜨린다.
 * tier·kind 도 taxonomy 에서 가져와 테스트가 실제 태그 메타데이터와 어긋나지 않게 한다.
 */
const sig = (
  id: string, side: Signal['side'], strength: 1 | 2 | 3 = 1, barIndex = 10,
): Signal => {
  const def = TAG_BY_ID.get(id)
  if (!def) throw new Error(`테스트가 taxonomy 에 없는 태그를 쓴다: ${id}`)
  return {
    id, tier: def.tier, kind: def.kind, side, barIndex,
    confidence: 'A', strength, evidence: '',
  }
}

describe('setupScore', () => {
  it('base = Σ(태그 배점 × 강도)', () => {
    // liq_sweep_low 4×2 = 8, candle_hammer 2×1 = 2 → base 10
    // kind 2종(smc·candle) → diversity 4, 상충 없음
    const s = [sig('liq_sweep_low', 'bullish', 2), sig('candle_hammer', 'bullish')]
    expect(setupScore(s)).toBe(10 + 4 - 0)
  })

  it('상충하면 감점한다', () => {
    // 스윕 4점씩 = 8, kind 1종(smc) → diversity 2, min(1,1)=1 → conflict 3
    const s = [sig('liq_sweep_low', 'bullish'), sig('liq_sweep_high', 'bearish')]
    expect(setupScore(s)).toBe(8 + 2 - 3)
  })

  it('신호가 없으면 0이다', () => {
    expect(setupScore([])).toBe(0)
  })

  it('중립 신호는 base·diversity 에는 들어가지만 상충 감점에는 끼지 않는다', () => {
    // trend_range 3 + liq_sweep_low 4 = 7, kind 2종 → 4, 중립은 어느 쪽도 아니라 감점 0
    const s = [sig('trend_range', 'neutral'), sig('liq_sweep_low', 'bullish')]
    expect(setupScore(s)).toBe(7 + 4 - 0)
  })

  it('오더블록이 유동성 청산보다 낮게 매겨진다', () => {
    // 개정된 가중치의 핵심 — 단독 오더블록(3점)은 뒤에 남은 유동성 때문에 뚫릴 수
    // 있는 자리라 스윕(4점)보다 신뢰도가 낮다.
    expect(setupScore([sig('ob_bull_support', 'bullish')]))
      .toBeLessThan(setupScore([sig('liq_sweep_low', 'bullish')]))
  })
})

describe('골든 콤보 — 유동성을 흡수한 오더블록', () => {
  it('같은 봉에서 같은 방향의 스윕과 오더블록이 나면 가산한다', () => {
    // 스윕 4 + 오더블록 3 = 7, kind 1종(smc) → diversity 2, 상충 0, 보너스 +2 → 11
    const s = [sig('liq_sweep_low', 'bullish', 1, 100), sig('ob_bull_support', 'bullish', 1, 100)]
    expect(hasGoldenCombo(s)).toBe(true)
    expect(setupScore(s)).toBe(7 + 2 - 0 + GOLDEN_COMBO_BONUS)
  })

  it('스윕 4 + 오더블록 3 + 가산 2 = 9점이 된다', () => {
    // 사용자 노트의 Case B — 세력이 목적을 달성한 최상위 타점
    const s = [sig('liq_sweep_low', 'bullish', 1, 100), sig('ob_bull_support', 'bullish', 1, 100)]
    const base = signalWeight(s[0]) + signalWeight(s[1])
    expect(base + GOLDEN_COMBO_BONUS).toBe(9)
  })

  it('방향이 다르면 가산하지 않는다', () => {
    // 저점 스윕(강세)과 약세 오더블록은 같은 이야기가 아니다
    const s = [sig('liq_sweep_low', 'bullish', 1, 100), sig('ob_bear_resistance', 'bearish', 1, 101)]
    expect(hasGoldenCombo(s)).toBe(false)
  })

  it('봉이 멀면 가산하지 않는다', () => {
    const far = GOLDEN_COMBO_BARS + 1
    const s = [sig('liq_sweep_low', 'bullish', 1, 100), sig('ob_bull_support', 'bullish', 1, 100 + far)]
    expect(hasGoldenCombo(s)).toBe(false)
  })

  it('경계값: 정확히 GOLDEN_COMBO_BARS 만큼 떨어져 있으면 가산한다', () => {
    const s = [
      sig('liq_sweep_low', 'bullish', 1, 100),
      sig('ob_bull_support', 'bullish', 1, 100 + GOLDEN_COMBO_BARS),
    ]
    expect(hasGoldenCombo(s)).toBe(true)
  })

  it('한 봉만 어긋나도 가산하지 않는다 — "동시에" 는 같은 봉을 뜻한다', () => {
    // 간격을 3봉까지 허용했더니 후보의 46.8%에 붙었다(실측). 최상위 지표가 절반에
    // 붙으면 배점 인플레이션이라, 노트 원문의 "동시에" 를 문자 그대로 같은 봉으로 읽는다.
    expect(GOLDEN_COMBO_BARS).toBe(0)
    const s = [sig('liq_sweep_low', 'bullish', 1, 100), sig('ob_bull_support', 'bullish', 1, 101)]
    expect(hasGoldenCombo(s)).toBe(false)
  })

  it('오더블록만 있으면 가산하지 않는다', () => {
    expect(hasGoldenCombo([sig('ob_bull_support', 'bullish')])).toBe(false)
  })

  it('스윕만 있으면 가산하지 않는다', () => {
    expect(hasGoldenCombo([sig('liq_sweep_low', 'bullish')])).toBe(false)
  })

  it('조합이 여러 쌍이어도 가산은 한 번뿐이다', () => {
    // 쌍마다 주면 오더블록이 여러 개인 구간에서 점수가 폭주한다
    const many = [
      sig('liq_sweep_low', 'bullish', 1, 100),
      sig('ob_bull_support', 'bullish', 1, 100),
      sig('ob_bull_support', 'bullish', 1, 101),
      sig('ob_bull_support', 'bullish', 1, 102),
    ]
    const one = [sig('liq_sweep_low', 'bullish', 1, 100), sig('ob_bull_support', 'bullish', 1, 100)]
    const extraWeight = signalWeight(many[2]) + signalWeight(many[3])
    // 오더블록 2개가 더 붙은 만큼만 늘고, 보너스는 그대로 1회
    expect(setupScore(many)).toBe(setupScore(one) + extraWeight)
  })
})

describe('dominantSide', () => {
  it('가중 합이 큰 쪽을 낸다', () => {
    // 스윕 4 vs 캔들 2
    const s = [sig('liq_sweep_low', 'bullish'), sig('candle_shooting_star', 'bearish')]
    expect(dominantSide(s)).toBe('bullish')
  })

  it('동률이면 neutral', () => {
    const s = [sig('liq_sweep_low', 'bullish'), sig('liq_sweep_high', 'bearish')]
    expect(dominantSide(s)).toBe('neutral')
  })

  it('개수가 아니라 가중치로 정한다 — 수가 적어도 무거우면 이긴다', () => {
    // bullish 1개 = 4×3 = 12, bearish 3개 = 2×1 × 3 = 6
    const s = [
      sig('liq_sweep_low', 'bullish', 3),
      sig('candle_shooting_star', 'bearish'), sig('candle_bear_engulf', 'bearish'),
      sig('candle_bear_harami', 'bearish'),
    ]
    expect(dominantSide(s)).toBe('bullish')
  })

  it('신호가 없으면 neutral', () => {
    expect(dominantSide([])).toBe('neutral')
  })

  it('전부 중립이면 neutral', () => {
    expect(dominantSide([sig('trend_range', 'neutral'), sig('bb_squeeze', 'neutral')])).toBe('neutral')
  })
})

describe('difficultyOf', () => {
  const BULL_CANDLES = [
    'candle_hammer', 'candle_inv_hammer', 'candle_bull_engulf',
    'candle_bull_harami', 'candle_morning_star',
  ]
  const BEAR_CANDLES = ['candle_shooting_star', 'candle_bear_engulf', 'candle_bear_harami']

  it('반대편이 없으면 easy', () => {
    const s = BULL_CANDLES.slice(0, 4).map((id) => sig(id, 'bullish'))
    expect(difficultyOf(s)).toBe('easy')
  })

  it('가중치가 팽팽하면 hard', () => {
    const s = [sig('liq_sweep_low', 'bullish'), sig('liq_sweep_high', 'bearish')]
    expect(difficultyOf(s)).toBe('hard')
  })

  // EASY_AGREEMENT 는 파트마다 태그가 늘 때 재확정된다(0.75 → 0.70, Part 5).
  // 아래 두 검사는 그 경계의 양쪽을 리터럴로 못박는다 — 상수를 참조하면 값이 바뀔 때
  // 검사도 함께 따라 내려가 아무것도 지키지 못한다.
  it('우세한 쪽이 7:3 이상이면 easy', () => {
    // bullish 4×2=8, bearish 1×2=2 → 쏠림도 0.80 ≥ 0.70
    const s = [...BULL_CANDLES.slice(0, 4).map((id) => sig(id, 'bullish')), sig(BEAR_CANDLES[0], 'bearish')]
    expect(difficultyOf(s)).toBe('easy')
  })

  it('우세하지만 7:3 에는 못 미치면 medium', () => {
    // bullish 5×2=10, bearish 3×2=6 → 쏠림도 0.625 (0.62 이상 0.70 미만)
    const s = [
      ...BULL_CANDLES.map((id) => sig(id, 'bullish')),
      ...BEAR_CANDLES.slice(0, 3).map((id) => sig(id, 'bearish')),
    ]
    expect(difficultyOf(s)).toBe('medium')
  })

  it('개수가 아니라 가중치로 나눈다 — 수는 밀려도 무거우면 쏠린 것이다', () => {
    // bullish 1×(4×3)=12, bearish 3×(2×1)=6 → 쏠림도 0.667 → medium.
    // 개수로만 보면 1:3 이라 '반대가 우세' 로 읽히지만 무게로는 오히려 bullish 가 앞선다.
    const s = [
      sig('liq_sweep_low', 'bullish', 3),
      ...BEAR_CANDLES.map((id) => sig(id, 'bearish')),
    ]
    expect(difficultyOf(s)).toBe('medium')
  })

  it('한 방향뿐이면 개수가 적어도 easy — 반대 근거가 없으니 헷갈릴 것이 없다', () => {
    // 개수 기준(4개 이상)이었다면 medium 이었다. 가중치 기준에서는 상충이 0이면 easy 다.
    expect(difficultyOf([sig('liq_sweep_low', 'bullish'), sig('fvg_bull', 'bullish')])).toBe('easy')
  })

  it('중립 신호는 쏠림도를 흐리지 않는다', () => {
    // 중립을 분모에 넣으면 쏠림도가 내려가 난이도가 뒤바뀐다. 방향 근거만으로 잰다.
    const s = [
      sig('liq_sweep_low', 'bullish'),
      sig('trend_range', 'neutral'), sig('bb_squeeze', 'neutral'), sig('candle_doji', 'neutral'),
    ]
    expect(difficultyOf(s)).toBe('easy')
  })

  it('신호가 하나도 없으면 hard — 짚을 근거가 없다', () => {
    expect(difficultyOf([])).toBe('hard')
  })

  it('전부 중립이면 hard — 방향 근거가 0개인 것은 근거가 없는 것과 같다', () => {
    const s = ['trend_range', 'bb_squeeze', 'candle_doji', 'candle_inside_bar', 'candle_tri_star']
      .map((id) => sig(id, 'neutral'))
    expect(difficultyOf(s)).toBe('hard')
  })

  it('경계값: 쏠림도 0.75 는 easy, 0.62 는 medium', () => {
    // 정확히 0.75 → easy (>= 이므로). bullish 3×2=6, bearish 1×2=2 → 6/8 = 0.75
    expect(difficultyOf([
      ...BULL_CANDLES.slice(0, 3).map((id) => sig(id, 'bullish')), sig(BEAR_CANDLES[0], 'bearish'),
    ])).toBe('easy')
    // 정확히 0.62 → medium (hard 는 미만이므로). bullish 31, bearish 19 → 31/50 = 0.62
    expect(difficultyOf([
      sig('liq_sweep_low', 'bullish', 3),      // 4×3 = 12
      sig('ob_bull_support', 'bullish', 3),    // 3×3 =  9
      sig('ma_aligned_bull', 'bullish', 2),    // 3×2 =  6
      sig('candle_hammer', 'bullish', 2),      // 2×2 =  4  → 31
      sig('liq_sweep_high', 'bearish', 3),     // 4×3 = 12
      sig('ob_bear_resistance', 'bearish', 1), // 3×1 =  3
      sig('candle_shooting_star', 'bearish', 2), // 2×2 = 4  → 19
    ])).toBe('medium')
  })
})

describe('mergeCandidates', () => {
  const cand = (barIndex: number, setupScore: number): SetupCandidate =>
    ({ barIndex, setupScore, difficulty: 'medium', dominantSide: 'bullish', activeCount: 1 })

  it('창 안에서는 점수가 가장 높은 하나만 남긴다', () => {
    const out = mergeCandidates([cand(100, 10), cand(105, 30), cand(110, 20)], 20)
    expect(out.map((c) => c.barIndex)).toEqual([105])
  })

  it('동점이면 이른 봉이 이긴다', () => {
    const out = mergeCandidates([cand(100, 30), cand(105, 30)], 20)
    expect(out.map((c) => c.barIndex)).toEqual([100])
  })

  it('입력 순서를 뒤섞어도 결과가 같다', () => {
    const input = [cand(100, 10), cand(118, 40), cand(140, 25), cand(155, 25), cand(200, 5)]
    const straight = mergeCandidates(input, 20)
    const shuffled = mergeCandidates([input[3], input[0], input[4], input[2], input[1]], 20)
    expect(shuffled).toEqual(straight)
    expect(straight.map((c) => c.barIndex)).toEqual([...straight.map((c) => c.barIndex)].sort((a, b) => a - b))
  })

  it('자기 창 안에 자기보다 센 후보가 없으면 살아남는다 (체이닝 그리디 회귀)', () => {
    // 브리프의 체이닝 병합은 앵커를 앞으로 끌고 가며 bar 0 을 bar 19 로, 다시 bar 38 로
    // 갈아치워 bar 0 을 잃었다. bar 0 과 bar 38 은 38봉 떨어져 있어 둘 다 남아야 한다.
    const out = mergeCandidates([cand(0, 10), cand(19, 12), cand(38, 100)], 20)
    expect(out.map((c) => c.barIndex)).toEqual([0, 38])
  })

  it('남은 후보끼리는 mergeWindow 이상 떨어져 있다', () => {
    const input = Array.from({ length: 60 }, (_, i) => cand(i * 3, (i * 37) % 41))
    const out = mergeCandidates(input, 20)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].barIndex - out[i - 1].barIndex).toBeGreaterThanOrEqual(20)
    }
  })
})

describe('scanForSetups', () => {
  const cs = synthCandles(600)

  /** 지름길 없이 모든 봉에 정확 경로를 돌린 봉별 점수표 (임계값과 무관하므로 한 번만 만든다) */
  let allRows: SetupCandidate[] | null = null
  const exactRows = (): SetupCandidate[] => {
    if (allRows) return allRows
    allRows = []
    for (let i = WARMUP; i < cs.length; i++) {
      const active = activeSignalsAt(cs, i)
      allRows.push({
        barIndex: i, setupScore: setupScore(active), difficulty: difficultyOf(active),
        dominantSide: dominantSide(active), activeCount: active.length,
      })
    }
    return allRows
  }

  /** 지름길 없이 만든 기준 답안 */
  const bruteForce = (minScore: number, mergeWindow: number): SetupCandidate[] =>
    mergeCandidates(exactRows().filter((r) => r.setupScore >= minScore), mergeWindow)

  it('기본값으로도 후보가 실제로 나온다 (검사가 공허하지 않다)', () => {
    expect(scanForSetups(cs).length).toBeGreaterThan(5)
  }, 10000)

  it('후보의 barIndex 가 오름차순이고 중복되지 않는다', () => {
    const out = scanForSetups(cs)
    const idx = out.map((c) => c.barIndex)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    expect(new Set(idx).size).toBe(idx.length)
  })

  it('인접 후보를 병합해 mergeWindow 안에 하나만 남긴다', () => {
    const out = scanForSetups(cs, { minScore: 0, mergeWindow: 20 })
    expect(out.length).toBeGreaterThan(0)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].barIndex - out[i - 1].barIndex).toBeGreaterThanOrEqual(20)
    }
  })

  it('모든 후보가 minScore 를 넘는다', () => {
    // 후보가 하나도 없으면 루프가 돌지 않아 조용히 통과한다. 단언이 실제로 실행됐는지 못박는다.
    expect.hasAssertions()
    for (const c of scanForSetups(cs, { minScore: 150 })) {
      expect(c.setupScore).toBeGreaterThanOrEqual(150)
    }
  })

  it('후보의 필드 전부가 2단계(정확) 계산과 일치한다', () => {
    const out = scanForSetups(cs)
    expect(out.length).toBeGreaterThan(0)
    for (const c of out) {
      const active = activeSignalsAt(cs, c.barIndex)
      expect(c.setupScore).toBe(setupScore(active))
      expect(c.difficulty).toBe(difficultyOf(active))
      expect(c.dominantSide).toBe(dominantSide(active))
      expect(c.activeCount).toBe(active.length)
    }
  })

  // 아래 두 검사는 봉마다 detectAll 을 돌리는 전수 스캔이라 구조적으로 무겁다.
  // Part 3 에서 볼륨 프로파일(창 120봉을 봉마다 재계산, O(n·LOOKBACK))이 들어오며
  // detectAll 이 1000봉당 약 15ms → 20ms 가 됐고 기본 5초 제한을 넘었다.
  // 프로덕션 경로는 영향이 없다 — scanForSetups 2단계는 후보(1000봉당 약 27개)에만
  // 정확 경로를 돌리므로 여전히 1초 미만이다. 느려진 것은 이 전수 검사뿐이라
  // 제한만 올린다.
  const HEAVY_TIMEOUT = 60_000

  it('2단계 스캔 결과가 전수 정확 스캔과 완전히 같다 — 1단계가 후보를 잃지 않는다', () => {
    // 위험 체크포인트의 핵심. 1단계 coarseFloor 는 증명이 아니라 실측으로 고른 값이라,
    // "빠른 경로가 느린 경로와 같은 답을 낸다" 를 회귀로 고정해 둔다.
    for (const minScore of [DEFAULT_MIN_SCORE, 100, 160]) {
      expect(scanForSetups(cs, { minScore })).toEqual(bruteForce(minScore, DEFAULT_MERGE_WINDOW))
    }
  }, HEAVY_TIMEOUT)

  it('같은 입력에 항상 같은 후보를 낸다', () => {
    expect(scanForSetups(cs)).toEqual(scanForSetups(cs))
    expect(scanForSetups(synthCandles(600))).toEqual(scanForSetups(cs))
  }, HEAVY_TIMEOUT)

  it('워밍업 구간에서는 후보를 내지 않는다', () => {
    // WARMUP 을 그대로 비교에 쓰면 이 검사는 항상 참이다 — scanForSetups 가 i = WARMUP
    // 부터 훑고 병합은 거르고 정렬만 하므로, WARMUP 이 몇이든 구조적으로 성립한다.
    // 지켜야 할 성질은 "WARMUP 이 상수를 따라 내려가지 않는다" 이므로 리터럴로 못박는다.
    // 지표(EMA200 등)가 아직 덜 데워진 구간에서 후보가 나오면 안 된다.
    expect(WARMUP).toBe(120)

    const out = scanForSetups(cs)
    expect(out.length).toBeGreaterThan(0)   // 빈 배열이면 every 가 공허하게 참이다
    for (const c of out) expect(c.barIndex).toBeGreaterThanOrEqual(120)
  })

  it('워밍업보다 짧은 입력은 후보가 없다', () => {
    expect(scanForSetups(synthCandles(120), { minScore: 0 })).toEqual([])
    expect(scanForSetups([], { minScore: 0 })).toEqual([])
  })
})

describe('1단계 근사와 정확 집합의 부분집합 관계', () => {
  const cs = synthCandles(600)
  const key = (s: Signal) => `${s.id}|${s.barIndex}|${s.side}|${s.strength}|${s.tier}|${s.kind}`

  /**
   * approx 에 있는데 exact 에 없는 신호를 개수까지 따져 찾는다.
   * Set 이 아니라 다중집합으로 센다 — 같은 신호가 근사에서 2개, 정확에서 1개 나오는
   * 경우도 부분집합 위반이다.
   */
  const violations = (approx: Signal[], exact: Signal[]): string[] => {
    const left = new Map<string, number>()
    for (const s of exact) left.set(key(s), (left.get(key(s)) ?? 0) + 1)
    const out: string[] = []
    for (const s of approx) {
      const k = key(s)
      const n = left.get(k) ?? 0
      if (n === 0) out.push(k)
      else left.set(k, n - 1)
    }
    return out
  }

  it('1단계 과소추정이 COARSE_SLACK 을 넘지 않는다 (병합 전, 봉 단위)', () => {
    // shipped 상수 COARSE_SLACK 이 기대는 측정을 회귀로 고정한다.
    // 병합 뒤 후보만 비교하면 NMS 가 어차피 억제했을 봉의 누락이 안 보인다 — 그런데
    // coarseFloor 에 걸려 떨어지는 봉은 창 안에서 점수가 가장 낮은, 바로 NMS 가 버릴
    // 봉이다. 그래서 실패가 몰리는 자리와 병합 후 비교가 둔한 자리가 정확히 겹친다.
    // 여기서는 봉 단위로 직접 잰다.
    const all = detectAll(cs)
    let maxGap = -Infinity
    let minGap = Infinity
    for (let i = WARMUP; i < cs.length; i++) {
      // 양수 = 1단계가 낮게 봤다(과소추정). COARSE_SLACK 이 막아야 하는 방향이다.
      const gap = setupScore(activeSignalsAt(cs, i)) - setupScore(filterActive(cs, all, i))
      if (gap > maxGap) maxGap = gap
      if (gap < minGap) minGap = gap
    }
    expect(maxGap, `과소추정 최대 ${maxGap} 가 COARSE_SLACK ${COARSE_SLACK} 이상이다`)
      .toBeLessThan(COARSE_SLACK)
    // 실제로 과소추정이 일어나긴 하는지도 확인한다 — 0이면 COARSE_SLACK 이 아무것도
    // 막고 있지 않다는 뜻이고, 그럼 이 검사가 공허하다.
    expect(maxGap).toBeGreaterThan(0)
    // 반대 방향(과대추정, gap < 0)은 실패 조건이 아니다. setupScore 의 conflict 항이
    // 단조가 아니라 신호가 빠지면 점수가 오르는 경우를 구성할 수는 있지만, 이 픽스처
    // 에서도 실데이터 10계열에서도 한 번도 관측되지 않았다(최소 간극이 정확히 0).
    // 관측되더라도 안전한 방향이라 게이트는 양의 꼬리만 본다.
    expect(minGap).toBeGreaterThanOrEqual(0)
  })

  it('전 구간에서 1단계 근사가 정확 집합의 부분집합이다', () => {
    // 하네스가 보증하는 부등식(스펙 2.5)이 실제로 성립하는지 고정한다.
    // 깨지면 1단계가 정확 집합에 없는 신호를 만들어낸 것이고, 지름길이 무효가 된다.
    const all = detectAll(cs)
    let checkedSignals = 0
    for (let at = WARMUP; at < cs.length; at += 10) {
      const approx = filterActive(cs, all, at)
      const exact = activeSignalsAt(cs, at)
      checkedSignals += approx.length
      expect(violations(approx, exact), `bar ${at}: 정확 집합에 없는 근사 신호`).toEqual([])
    }
    // 근사가 전부 빈 배열이었다면 위 검사는 공허하다.
    expect(checkedSignals).toBeGreaterThan(100)
  })

  it('부분집합 검사 자체가 위반을 실제로 잡아낸다', () => {
    // 위 검사가 "항상 통과하는 검사" 가 아님을 보인다: 1단계가 정확 집합에 없는 신호를
    // 하나라도 만들어내면 반드시 걸린다.
    const at = 300
    const exact = activeSignalsAt(cs, at)
    const approx = filterActive(cs, detectAll(cs), at)
    const phantom: Signal = {
      id: 'liq_sweep_low', tier: 1, kind: 'smc', side: 'bullish',
      barIndex: at, confidence: 'A', strength: 3, evidence: '유령',
    }
    expect(violations([...approx, phantom], exact).length).toBe(1)
    // 개수까지 세는지도 확인한다 — 같은 신호를 하나 더 끼워도 걸려야 한다.
    expect(violations([...approx, ...approx.slice(0, 1)], exact).length).toBe(1)
  })
})

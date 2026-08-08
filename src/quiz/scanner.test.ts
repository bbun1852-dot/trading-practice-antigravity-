import { describe, it, expect } from 'vitest'
import {
  setupScore, dominantSide, difficultyOf, mergeCandidates, scanForSetups,
  WARMUP, DEFAULT_MIN_SCORE, DEFAULT_MERGE_WINDOW,
} from './scanner'
import { activeSignalsAt, filterActive } from './lifetime'
import { detectAll } from '../analysis/signals'
import type { Signal } from '../analysis/signalTypes'
import type { SetupCandidate } from './types'
import { synthCandles } from '../analysis/fixtures'

const sig = (
  id: string, tier: 1 | 2 | 3 | 4, kind: Signal['kind'], side: Signal['side'],
  strength: 1 | 2 | 3 = 1, barIndex = 10,
): Signal => ({ id, tier, kind, side, barIndex, confidence: 'A', strength, evidence: '' })

describe('setupScore', () => {
  it('base = Σ(tierWeight × strength)', () => {
    // Tier1×2 = 10, Tier4×1 = 2 → base 12, kind 2종 → diversity 4, 상충 없음
    const s = [sig('a', 1, 'smc', 'bullish', 2), sig('b', 4, 'candle', 'bullish', 1)]
    expect(setupScore(s)).toBe(12 + 4 - 0)
  })

  it('상충하면 감점한다', () => {
    // Tier1×1 각각 = 10, kind 1종 → diversity 2, min(1,1)=1 → conflict 3
    const s = [sig('a', 1, 'smc', 'bullish'), sig('b', 1, 'smc', 'bearish')]
    expect(setupScore(s)).toBe(10 + 2 - 3)
  })

  it('신호가 없으면 0이다', () => {
    expect(setupScore([])).toBe(0)
  })

  it('중립 신호는 base·diversity 에는 들어가지만 상충 감점에는 끼지 않는다', () => {
    // Tier3×1 = 3, Tier1×1 = 5 → base 8, kind 2종 → 4, 중립은 bull/bear 어느 쪽도 아니므로 감점 0
    const s = [sig('n', 3, 'structure', 'neutral'), sig('a', 1, 'smc', 'bullish')]
    expect(setupScore(s)).toBe(8 + 4 - 0)
  })
})

describe('dominantSide', () => {
  it('가중 합이 큰 쪽을 낸다', () => {
    const s = [sig('a', 1, 'smc', 'bullish'), sig('b', 4, 'candle', 'bearish')]
    expect(dominantSide(s)).toBe('bullish')
  })

  it('동률이면 neutral', () => {
    const s = [sig('a', 1, 'smc', 'bullish'), sig('b', 1, 'smc', 'bearish')]
    expect(dominantSide(s)).toBe('neutral')
  })

  it('개수가 아니라 가중치로 정한다 — 수가 적어도 무거우면 이긴다', () => {
    // bullish 1개 = 5×3 = 15, bearish 3개 = 2×1 × 3 = 6
    const s = [
      sig('a', 1, 'smc', 'bullish', 3),
      sig('b', 4, 'candle', 'bearish'), sig('c', 4, 'candle', 'bearish'), sig('d', 4, 'candle', 'bearish'),
    ]
    expect(dominantSide(s)).toBe('bullish')
  })

  it('신호가 없으면 neutral', () => {
    expect(dominantSide([])).toBe('neutral')
  })

  it('전부 중립이면 neutral', () => {
    expect(dominantSide([sig('a', 3, 'structure', 'neutral'), sig('b', 3, 'structure', 'neutral')])).toBe('neutral')
  })
})

describe('difficultyOf', () => {
  it('반대편이 없으면 easy', () => {
    const s = [1, 2, 3, 4].map((i) => sig(`a${i}`, 4, 'candle', 'bullish'))
    expect(difficultyOf(s)).toBe('easy')
  })

  it('가중치가 팽팽하면 hard', () => {
    const s = [sig('a', 1, 'smc', 'bullish'), sig('b', 1, 'smc', 'bearish')]
    expect(difficultyOf(s)).toBe('hard')
  })

  it('우세한 쪽이 3배 이상이면 easy', () => {
    // bullish 4×(2×1)=8, bearish 1×(2×1)=2 → 쏠림도 0.80 ≥ 0.75
    const s = [...[1, 2, 3, 4].map((i) => sig(`a${i}`, 4, 'candle', 'bullish')), sig('b', 4, 'candle', 'bearish')]
    expect(difficultyOf(s)).toBe('easy')
  })

  it('우세하지만 3배에는 못 미치면 medium', () => {
    // bullish 5×2=10, bearish 2×2=4 → 쏠림도 0.714 (0.62 이상 0.75 미만)
    const s = [
      ...[1, 2, 3, 4, 5].map((i) => sig(`a${i}`, 4, 'candle', 'bullish')),
      sig('b1', 4, 'candle', 'bearish'), sig('b2', 4, 'candle', 'bearish'),
    ]
    expect(difficultyOf(s)).toBe('medium')
  })

  it('개수가 아니라 가중치로 나눈다 — 수는 밀려도 무거우면 쏠린 것이다', () => {
    // bullish 1×(5×3)=15, bearish 3×(2×1)=6 → 쏠림도 0.714 → medium.
    // 개수로만 보면 1:3 이라 '반대가 우세' 로 읽히지만 무게로는 오히려 bullish 가 앞선다.
    const s = [
      sig('a', 1, 'smc', 'bullish', 3),
      sig('b1', 4, 'candle', 'bearish'), sig('b2', 4, 'candle', 'bearish'), sig('b3', 4, 'candle', 'bearish'),
    ]
    expect(difficultyOf(s)).toBe('medium')
  })

  it('한 방향뿐이면 개수가 적어도 easy — 반대 근거가 없으니 헷갈릴 것이 없다', () => {
    // 개수 기준(4개 이상)이었다면 medium 이었다. 가중치 기준에서는 상충이 0이면 easy 다.
    expect(difficultyOf([sig('a', 1, 'smc', 'bullish'), sig('b', 1, 'smc', 'bullish')])).toBe('easy')
  })

  it('중립 신호는 쏠림도를 흐리지 않는다', () => {
    // 중립을 분모에 넣으면 쏠림도가 내려가 난이도가 뒤바뀐다. 방향 근거만으로 잰다.
    const s = [
      sig('a', 1, 'smc', 'bullish'),
      ...[1, 2, 3].map((i) => sig(`n${i}`, 3, 'structure', 'neutral')),
    ]
    expect(difficultyOf(s)).toBe('easy')
  })

  it('신호가 하나도 없으면 hard — 짚을 근거가 없다', () => {
    expect(difficultyOf([])).toBe('hard')
  })

  it('전부 중립이면 hard — 방향 근거가 0개인 것은 근거가 없는 것과 같다', () => {
    const s = [1, 2, 3, 4, 5].map((i) => sig(`n${i}`, 3, 'structure', 'neutral'))
    expect(difficultyOf(s)).toBe('hard')
  })

  it('경계값: 쏠림도 0.75 는 easy, 0.62 는 medium', () => {
    // 정확히 0.75 → easy (>= 이므로). bullish 3×2=6, bearish 1×2=2 → 6/8 = 0.75
    expect(difficultyOf([
      ...[1, 2, 3].map((i) => sig(`a${i}`, 4, 'candle', 'bullish')), sig('b', 4, 'candle', 'bearish'),
    ])).toBe('easy')
    // 정확히 0.62 → medium (hard 는 미만이므로). bullish 31, bearish 19 → 31/50 = 0.62
    expect(difficultyOf([
      sig('a', 3, 'structure', 'bullish', 3),                                  // 9
      sig('a2', 4, 'candle', 'bullish', 3), sig('a3', 4, 'ma', 'bullish', 3),  // 6+6 = 12
      sig('a4', 4, 'momentum', 'bullish', 3), sig('a5', 4, 'volume', 'bullish', 2), // 6+4 = 10
      sig('b', 1, 'smc', 'bearish', 3), sig('b2', 4, 'candle', 'bearish', 2),  // 15+4 = 19
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
  })

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

  it('2단계 스캔 결과가 전수 정확 스캔과 완전히 같다 — 1단계가 후보를 잃지 않는다', () => {
    // 위험 체크포인트의 핵심. 1단계 coarseFloor 는 증명이 아니라 실측으로 고른 값이라,
    // "빠른 경로가 느린 경로와 같은 답을 낸다" 를 회귀로 고정해 둔다.
    for (const minScore of [DEFAULT_MIN_SCORE, 100, 160]) {
      expect(scanForSetups(cs, { minScore })).toEqual(bruteForce(minScore, DEFAULT_MERGE_WINDOW))
    }
  })

  it('같은 입력에 항상 같은 후보를 낸다', () => {
    expect(scanForSetups(cs)).toEqual(scanForSetups(cs))
    expect(scanForSetups(synthCandles(600))).toEqual(scanForSetups(cs))
  })

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

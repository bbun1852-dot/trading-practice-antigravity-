import type { Candle } from '../data/types'
import { type Signal, TIER_WEIGHT } from '../analysis/signalTypes'
import { detectAll } from '../analysis/signals'
import { filterActive, activeSignalsAt } from './lifetime'
import type { SetupCandidate, Difficulty } from './types'

/** 지표 워밍업에 필요한 봉 수. 이전 구간은 신호가 불완전하다 */
export const WARMUP = 120

/**
 * 실측으로 확정한 기본 임계값 (scripts/calibrate.ts).
 *
 * 후보 밀도 게이트는 "1000봉당 15~40개" 이고, 판정은 계열별이다. 심볼 5종 × 4h/1d,
 * 창을 2026-08-01 로 고정한 1000봉에서 계열별 밀도는 24~29개, 표본외 창(2025-10-01)
 * 에서도 25~31개로 열 계열 전부 통과한다. 125 는 게이트 양쪽 경계까지의 최소 여유를
 * 최대로 만드는 값이다 (두 창 모두 여유 9). 120·130·135 도 통과하지만 여유가 더 작다.
 */
export const DEFAULT_MIN_SCORE = 125

/** 후보 사이 최소 간격. 같은 국면을 여러 문제로 반복해서 내지 않기 위한 것이다 */
export const DEFAULT_MERGE_WINDOW = 20

/**
 * 1단계 임계값을 목표보다 얼마나 낮게 잡을 것인가.
 *
 * 1단계는 정확 집합의 부분집합만 보므로 점수를 과소추정한다. 실측: 심볼 5종 × 4h/1d
 * 1000봉, 봉 8800개 전수에서 setupScore(1단계) − setupScore(2단계) 는 최대 0,
 * 최소 −48 이었다(즉 과대추정은 한 건도 없었고 과소추정은 최대 48점). 60 은 그
 * 최악값에 25% 여유를 얹은 값이다.
 *
 * 배수(예: minScore × 0.7)가 아니라 절대값인 이유: 과소추정의 크기는 "나중에 메워져
 * 전체 실행에서 사라진 FVG·오더블록 몇 개의 가중치 합" 이라 점수 규모가 아니라 신호
 * 개수에 비례한다. 배수 규칙은 minScore 가 작을 때(예: 30 → 여유 9) 실측 최악값
 * 48을 못 덮고, 클 때만 우연히 안전하다.
 *
 * 넉넉히 잡는 비용도 실측했다 — 2단계 전수 실행이 1000봉에 약 2초라, 1단계가 걸러
 * 주는 양이 줄어도 실질 손해가 없다. scanner.test.ts 가 "2단계 결과 == 전수 정확
 * 스캔" 을 회귀로 고정한다.
 */
export const COARSE_SLACK = 60

/**
 * 근거 묶음의 셋업 점수.
 *
 * base(티어 가중 × 강도) + diversity(근거 종류 수 × 2) − conflict(상충 쌍 × 3).
 * 중립 신호는 base·diversity 에는 들어가지만 상충 계산에는 끼지 않는다.
 */
export function setupScore(signals: Signal[]): number {
  let base = 0
  let bull = 0
  let bear = 0
  const kinds = new Set<string>()
  for (const s of signals) {
    base += TIER_WEIGHT[s.tier] * s.strength
    kinds.add(s.kind)
    if (s.side === 'bullish') bull++
    else if (s.side === 'bearish') bear++
  }
  return base + 2 * kinds.size - 3 * Math.min(bull, bear)
}

/** 유효 근거의 가중 합이 큰 쪽. 개수가 아니라 가중치로 정한다 */
export function dominantSide(signals: Signal[]): 'bullish' | 'bearish' | 'neutral' {
  let bull = 0
  let bear = 0
  for (const s of signals) {
    const w = TIER_WEIGHT[s.tier] * s.strength
    if (s.side === 'bullish') bull += w
    else if (s.side === 'bearish') bear += w
  }
  if (bull === bear) return 'neutral'   // 신호 없음·전부 중립·정확한 동률
  return bull > bear ? 'bullish' : 'bearish'
}

/**
 * 쏠림도 = 우세한 쪽의 가중치 / 양쪽 가중치 합. 방향 근거가 없으면 null.
 * 0.5(완전 팽팽) ~ 1.0(한쪽뿐) 사이의 값이다.
 */
function agreementRatio(signals: Signal[]): number | null {
  let bull = 0
  let bear = 0
  for (const s of signals) {
    const w = TIER_WEIGHT[s.tier] * s.strength
    if (s.side === 'bullish') bull += w
    else if (s.side === 'bearish') bear += w
  }
  const total = bull + bear
  if (total === 0) return null
  return Math.max(bull, bear) / total
}

/** 우세한 쪽이 전체 가중치의 75% 이상 — 반대편의 3배 이상이면 방향이 뚜렷하다 */
const EASY_AGREEMENT = 0.75
/** 우세한 쪽이 62% 미만 — 반대편이 전체의 38% 넘게 차지하면 사실상 팽팽하다 */
const HARD_AGREEMENT = 0.62

/**
 * 문제 난이도. dominantSide 와 같은 잣대(TIER_WEIGHT × strength)로 재고, "몇 개가
 * 어느 쪽이냐" 가 아니라 "근거의 무게가 얼마나 한쪽으로 쏠렸느냐" 로 나눈다.
 *
 * 개수로 세던 원래 규칙(같은 방향 4개 이상 + 상충 0개 → easy / 개수 차 1 이하 → hard)은
 * 실데이터에서 사실상 상수였다. 유효 근거 중앙값이 11개인데 그중 반대편이 **정확히 0개**
 * 인 자리는 거의 없어서 easy 가 273개 중 1개(0.4%)였고, hard 도 "개수 차 1 이하" 라는
 * 좁은 표적이라 12%에 그쳤다. 두 계층이 같은 이유로 희귀했다 — 근거가 많은 집합에
 * 개수 기준을 들이댄 것이 원인이다. 가중치 비율은 근거 수가 늘어도 눈금이 무너지지 않는다.
 *
 * 임계값은 실측으로 정했다 (심볼 5종 × 4h/1d, 후보 273개). 확정값에서의 계층 비율은
 * easy 37.0% / medium 31.9% / hard 31.1% 이고, 표본외 창(2025-10-01, 후보 279개)에서도
 * 37.3 / 30.5 / 32.3 으로 같다. 어떤 계층도 10% 미만이거나 70% 초과가 아니다.
 *
 * 방향 근거가 하나도 없으면(신호가 없거나 전부 중립) hard 다. 짚을 게 없는 자리가
 * 제일 어렵다 — 이 경우를 easy 쪽으로 흘리면 "근거가 없다" 가 "근거가 한쪽뿐이다" 로
 * 둔갑한다.
 */
export function difficultyOf(signals: Signal[]): Difficulty {
  const agreement = agreementRatio(signals)
  if (agreement === null) return 'hard'
  if (agreement >= EASY_AGREEMENT) return 'easy'
  if (agreement < HARD_AGREEMENT) return 'hard'
  return 'medium'
}

/**
 * 인접 후보 병합 — 비최대 억제(NMS).
 *
 * 점수 내림차순으로 훑으며, 이미 채택된 후보의 mergeWindow 안에 들면 버린다.
 * 남은 후보는 barIndex 오름차순이고 서로 mergeWindow 이상 떨어져 있다.
 *
 * **"하나" 의 정의: 자기 창 안에서 점수가 가장 높은 후보. 동점이면 이른 봉이 이긴다.**
 * 정렬 키가 (점수 내림차순, barIndex 오름차순) 로 완전순서라, 입력 순서를 어떻게
 * 뒤섞어도 결과가 같다 — 같은 캔들이면 항상 같은 문제가 나온다.
 * (호출부는 barIndex 가 중복되지 않는 목록을 준다. 봉당 후보는 하나다.)
 *
 * 앞에서 뒤로 훑으며 앵커를 갈아치우는 방식은 쓰지 않는다. 그 방식은 앵커가 계속
 * 앞으로 끌려가서, 자기 창 안에 자기보다 센 후보가 없는데도 밀려나는 후보가 생긴다
 * (bar 0/19/38 에 점수 10/12/100, 창 20 이면 bar 0 이 사라진다 — 38봉이나 떨어진
 * bar 38 에게 밀려서다). 긴 상승 구간이 통째로 후보 하나로 접히는 것도 같은 원인이다.
 */
export function mergeCandidates(
  candidates: SetupCandidate[], mergeWindow = DEFAULT_MERGE_WINDOW,
): SetupCandidate[] {
  const win = Math.max(1, mergeWindow)
  const byRank = [...candidates].sort((a, b) => b.setupScore - a.setupScore || a.barIndex - b.barIndex)
  const kept: SetupCandidate[] = []
  for (const c of byRank) {
    if (kept.some((k) => Math.abs(k.barIndex - c.barIndex) < win)) continue
    kept.push(c)
  }
  return kept.sort((a, b) => a.barIndex - b.barIndex)
}

/**
 * 2단계 스캔.
 *
 * 1단계는 detectAll 을 1회만 돌리고 수명 규칙으로 근사 점수를 낸다 — O(n).
 * 하네스가 보증하는 부등식(스펙 2.5)에 의해 이 근사는 정확 집합의 부분집합이므로
 * 과소추정이며, 그래서 1단계 임계값을 minScore − COARSE_SLACK 으로 낮춰 잡는다.
 *
 * 2단계는 살아남은 후보에 대해서만 activeSignalsAt 로 정확히 다시 계산하고,
 * **점수·난이도·방향은 전부 2단계 결과만 쓴다.** 1단계 점수는 후보 선별에만 쓰이고
 * 밖으로 나가지 않는다 — 채점 경로가 지름길 값을 보는 일이 없어야 한다.
 *
 * 비용(실측, 1000봉): 1단계 약 40ms, 전 봉에 2단계를 돌리는 최악의 경우 약 2초.
 * (브리프는 "1000봉에 약 10분" 이라고 적고 있으나 이 코드베이스에서는 사실이 아니다.
 * 그래서 1단계의 이득은 대략 2배 수준이고, COARSE_SLACK 을 넉넉히 잡을 수 있다.)
 */
export function scanForSetups(
  cs: Candle[],
  opts: { minScore?: number; mergeWindow?: number } = {},
): SetupCandidate[] {
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE
  const mergeWindow = opts.mergeWindow ?? DEFAULT_MERGE_WINDOW
  const coarseFloor = minScore - COARSE_SLACK

  // ── 1단계: detectAll 1회 + 수명 필터로 후보 봉만 추린다 ──
  const all = detectAll(cs)
  const rough: number[] = []
  for (let i = WARMUP; i < cs.length; i++) {
    if (setupScore(filterActive(cs, all, i)) >= coarseFloor) rough.push(i)
  }

  // ── 2단계: 후보 봉에만 정확 경로를 돌린다 ──
  const exact: SetupCandidate[] = []
  for (const barIndex of rough) {
    const active = activeSignalsAt(cs, barIndex)
    const score = setupScore(active)
    if (score < minScore) continue
    exact.push({
      barIndex,
      setupScore: score,
      difficulty: difficultyOf(active),
      dominantSide: dominantSide(active),
      activeCount: active.length,
    })
  }

  return mergeCandidates(exact, mergeWindow)
}

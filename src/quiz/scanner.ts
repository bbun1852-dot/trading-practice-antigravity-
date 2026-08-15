import type { Candle } from '../data/types'
import type { Signal } from '../analysis/signalTypes'
import { detectAll } from '../analysis/signals'
import { filterActive, activeSignalsAt } from './lifetime'
import { signalWeight } from './taxonomy'
import type { SetupCandidate, Difficulty } from './types'

/** 지표 워밍업에 필요한 봉 수. 이전 구간은 신호가 불완전하다 */
export const WARMUP = 120

/**
 * 실측으로 확정한 기본 임계값 (scripts/calibrate.ts).
 *
 * 후보 밀도 게이트는 "1000봉당 15~40개" 이고, 판정은 계열별이다. 심볼 5종 × 4h/1d,
 * 창을 2026-08-01 로 고정한 1000봉에서 계열별 밀도는 25~29개로 열 계열 전부 통과한다.
 * 85 는 게이트 양쪽 경계까지의 최소 여유를 최대로 만드는 값이다(여유 10).
 * 75·80·90 도 통과하지만 여유가 더 작다(8·9·8).
 *
 * **2026-08-06 재확정.** 이전 값은 125 였다. 가중치 체계 개정으로 태그 배점 상한이
 * 5 → 4 로 내려가면서 점수 분포 전체가 낮아졌고, 옛 임계값에서는 밀도가 9.5 로
 * 떨어져 열 계열 전부 실패했다. 임계값은 배점 체계에 종속되므로 taxonomy.ts 의
 * WEIGHT 를 건드리면 여기도 반드시 다시 재야 한다.
 *
 * 이 밀도는 "후보" 기준이지 "실제로 문제가 되는" 기준이 아니다 — generator.ts 의
 * 근거 개수 게이트(MIN_EVIDENCE~MAX_EVIDENCE)가 뒤에서 한 번 더 거른다.
 */
export const DEFAULT_MIN_SCORE = 85

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
export const COARSE_SLACK = 100

const SWEEP_IDS = new Set(['liq_sweep_low', 'liq_sweep_high'])
const ORDER_BLOCK_IDS = new Set(['ob_bull_support', 'ob_bear_resistance'])

/**
 * 스윕 봉과 오더블록 봉이 이만큼 이내로 붙어 있어야 "동시에 형성됐다"고 본다.
 *
 * 0 이다 — 같은 봉이어야 한다. 노트 원문이 "유동성 청산을 **일으키면서 동시에**
 * 형성된 오더블록" 이므로 문자 그대로 읽은 값이다.
 *
 * 처음에는 3 으로 잡았다가 실측하고 되돌렸다(2026-08-06, 심볼 5종 × 4h/1d = 8800봉,
 * 후보 278개). 발동률이 이렇게 갈린다:
 *
 *   간격 3 → 전체 봉 28.1% / 후보 46.8%
 *   간격 1 → 전체 봉 18.9% / 후보 30.6%
 *   간격 0 → 전체 봉  8.4% / 후보 15.8%   ← 확정
 *
 * 3 봉을 허용하면 후보의 절반 가까이에 가산이 붙는다. 스윕은 recent(14), 오더블록은
 * zone(50) 수명이라 임의의 봉에서 살아있는 쌍이 많고, 간격 조건은 "지금 막 일어난
 * 일" 을 요구하지 않기 때문이다. 절반에 붙는 보너스는 최상위 지표가 아니라 배점
 * 인플레이션이다.
 *
 * 스윕 가격이 오더블록 구간 안에 있을 것까지 요구하면 11.9% 로 더 내려가지만,
 * 같은 봉 44건 중 33건은 이미 구간 안이라(구조상 당연하다) 조건 하나를 더 달고
 * 11건을 더 거르는 셈이라 채택하지 않았다.
 */
export const GOLDEN_COMBO_BARS = 0
/** 골든 콤보 가산. 4(스윕) + 3(오더블록) + 2 = 9점이 되게 하는 값이다 */
export const GOLDEN_COMBO_BONUS = 2

/**
 * 골든 콤보 — 유동성을 흡수한 오더블록.
 *
 * 세력이 아래쪽 손절 물량을 받아먹고(스윕) 그 자리에서 바로 반등 캔들로 오더블록을
 * 만들었다면, 가격을 다시 그 아래로 내릴 이유가 없다. 단독 오더블록이 "뒤에 남은
 * 유동성 때문에 뚫릴 수 있는 자리" 인 것과 정반대다.
 *
 * 판정은 셋을 모두 요구한다: 같은 방향, 스윕과 오더블록이 둘 다 유효, 두 봉이
 * GOLDEN_COMBO_BARS 이내. 방향을 안 보면 저점 스윕과 약세 오더블록처럼 서로 반대인
 * 조합에도 가산이 붙는다.
 *
 * 가산은 조합이 몇 쌍이든 문제당 한 번만 준다. 쌍마다 주면 오더블록이 여러 개인
 * 구간에서 점수가 폭주한다.
 */
export function hasGoldenCombo(signals: Signal[]): boolean {
  const sweeps = signals.filter((s) => SWEEP_IDS.has(s.id))
  if (sweeps.length === 0) return false
  const blocks = signals.filter((s) => ORDER_BLOCK_IDS.has(s.id))
  if (blocks.length === 0) return false

  for (const sw of sweeps) {
    for (const ob of blocks) {
      if (sw.side !== ob.side) continue
      if (Math.abs(sw.barIndex - ob.barIndex) <= GOLDEN_COMBO_BARS) return true
    }
  }
  return false
}

/**
 * 근거 묶음의 셋업 점수.
 *
 * base(태그 배점 × 강도) + diversity(근거 종류 수 × 2) − conflict(상충 쌍 × 3)
 * + 골든 콤보 가산.
 * 중립 신호는 base·diversity 에는 들어가지만 상충 계산에는 끼지 않는다.
 *
 * base 를 TIER_WEIGHT 가 아니라 taxonomy 의 태그 배점에서 가져온다 — 개정된 가중치
 * 체계에서 유동성 청산(4점)과 오더블록(3점)이 갈라졌는데 감지기는 둘 다 tier 1 로
 * 배출하기 때문이다. 자세한 이유는 taxonomy.ts 의 WEIGHT 주석에 있다.
 */
export function setupScore(signals: Signal[]): number {
  let base = 0
  let bull = 0
  let bear = 0
  const kinds = new Set<string>()
  for (const s of signals) {
    base += signalWeight(s)
    kinds.add(s.kind)
    if (s.side === 'bullish') bull++
    else if (s.side === 'bearish') bear++
  }
  const bonus = hasGoldenCombo(signals) ? GOLDEN_COMBO_BONUS : 0
  return base + 2 * kinds.size - 3 * Math.min(bull, bear) + bonus
}

/** 유효 근거의 가중 합이 큰 쪽. 개수가 아니라 가중치로 정한다 */
export function dominantSide(signals: Signal[]): 'bullish' | 'bearish' | 'neutral' {
  let bull = 0
  let bear = 0
  for (const s of signals) {
    const w = signalWeight(s)
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
    const w = signalWeight(s)
    if (s.side === 'bullish') bull += w
    else if (s.side === 'bearish') bear += w
  }
  const total = bull + bear
  if (total === 0) return null
  return Math.max(bull, bear) / total
}

/** 우세한 쪽이 전체 가중치의 75% 이상 — 반대편의 3배 이상이면 방향이 뚜렷하다 */
// **2026-08-10 (Part 5) 재확정: 0.75 → 0.70.** 태그가 76종이 되며 한 시점에 살아 있는
// 근거가 다양해져 "한쪽으로 완전히 쏠린" 자리가 줄었다 — easy 가 9.8% 로 게이트 하한
// (10%)을 밑돌았다. 임계값은 근거 집합의 밀도에 종속되므로 태그를 늘리면 다시 재야 한다.
const EASY_AGREEMENT = 0.70
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

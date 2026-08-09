import { getCandles } from '../src/data/fileCache'
import { activeSignalsAt, filterActive } from '../src/quiz/lifetime'
import { detectAll } from '../src/analysis/signals'
import { TAGS, TAG_BY_ID, type LifetimeClass } from '../src/quiz/taxonomy'
import {
  scanForSetups, mergeCandidates, setupScore, difficultyOf, dominantSide,
  WARMUP, DEFAULT_MIN_SCORE, DEFAULT_MERGE_WINDOW, COARSE_SLACK,
} from '../src/quiz/scanner'
import type { SetupCandidate } from '../src/quiz/types'
import type { Candle, Timeframe } from '../src/data/types'

/**
 * 위험 체크포인트 ①: 결정 시점 하나가 내놓는 "유효 근거" 개수가 사람이 실제로
 * 짚을 수 있는 규모인지 실측한다. 너무 많으면 채점이 "이것도 놓쳤다" 로 도배되고,
 * 너무 적으면 채점이 아무 말도 못 한다.
 *
 * **게이트: 모든 심볼×타임프레임 계열의 중앙값이 8~15 안에 들고, 풀링 중앙값도 그래야 한다.**
 * 계열별이 실질 판정이다 — 이 도구의 약속은 "당신이 띄운 차트에서 동작한다" 이지
 * "차트 열 개 평균에서 동작한다" 가 아니다. 한 계열이라도 벗어나면 게이트 실패이고
 * 이 스크립트는 0이 아닌 코드로 끝난다.
 *
 * 위험 체크포인트 ②(파일 후반): 스캐너가 문제로 만들 만한 결정 시점을 1000봉당 몇 개나
 * 찾아내는지, 그리고 2단계 지름길이 전수 정확 스캔과 같은 답을 내는지를 실측한다.
 * 판정 기준은 ① 과 같다 — 계열별이 실질 판정이다.
 */

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT']
const TFS: Timeframe[] = ['4h', '1d']

const MEDIAN_MIN = 8
const MEDIAN_MAX = 15

/**
 * 데이터 창의 끝을 고정한다 (2026-08-01T00:00:00Z).
 *
 * 고정하지 않으면 fetchKlines 는 "지금까지의 최신 1000봉" 을 준다 — 하루 뒤에 돌리면
 * 4h 기준 6봉이 밀려서 인덱스 200 이 다른 봉을 가리킨다. 실제로 이것 때문에 같은
 * 파라미터·같은 결정 시점인데도 초판 측정과 재측정이 계열별로 크게 어긋났다
 * (LINKUSDT 4h 중앙값 7 → 8.5). 창이 떠다니면 (1) 판정을 나중에 재현할 수 없고,
 * (2) 튜닝 중 수치 변화가 파라미터 탓인지 데이터 탓인지 구분할 수 없다.
 * 위험 체크포인트의 계기판은 재현 가능해야 한다.
 */
const END_TIME = Math.floor(Date.UTC(2026, 7, 1) / 1000)

/**
 * 결정 시점 표본. 워밍업 120봉을 지난 200봉부터 20봉 간격으로 980봉까지 = 계열당 40개.
 *
 * 초판은 100봉 간격 8개였다. 계열별 중앙값이 실질 판정이 된 이상 계열당 8개는 너무
 * 얇다 — 표본 하나가 흔들리면 중앙값이 통째로 1 움직인다. 캔들은 이미 받아 놨으므로
 * 촘촘히 뜨는 비용은 CPU 뿐이다. 판정을 느슨하게 만드는 방향이 아니라 안정적으로
 * 만드는 방향의 변경이다.
 */
const AT = Array.from({ length: 40 }, (_, i) => 200 + i * 20)

/**
 * 백분위수 규약: R type 7 (= Excel PERCENTILE.INC).
 * 정렬한 표본에서 idx = p*(n-1) 을 잡고 이웃 두 값을 선형보간한다. 따라서 n 이
 * 짝수면 중앙값은 가운데 두 값의 평균이다(표본 8개면 4번째와 5번째의 평균).
 * 표본이 적을 때 "가장 가까운 순위" 규약보다 계단이 덜 튄다.
 */
function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length
  if (n === 0) return NaN
  if (n === 1) return sortedAsc[0]
  const idx = p * (n - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

type Dist = { n: number; min: number; p25: number; median: number; p75: number; max: number }

function dist(values: number[]): Dist {
  const s = [...values].sort((a, b) => a - b)
  return {
    n: s.length,
    min: s[0],
    p25: percentile(s, 0.25),
    median: percentile(s, 0.5),
    p75: percentile(s, 0.75),
    max: s[s.length - 1],
  }
}

const passes = (median: number) => median >= MEDIAN_MIN && median <= MEDIAN_MAX

/** 정수는 정수로, 보간된 값만 소수 한 자리로 */
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))

function lifetimeLabel(lt: LifetimeClass): string {
  switch (lt.kind) {
    case 'bar':    return 'bar'
    case 'recent': return `recent(${lt.bars})`
    case 'zone':   return `zone(${lt.maxBars})`
    case 'state':  return `state(${lt.group})`
  }
}

// ── 측정 ────────────────────────────────────────────────────────────────────

type Series = { label: string; counts: number[] }

const series: Series[] = []
const pooled: number[] = []
const tagHits = new Map<string, number>()
/** 체크포인트 ② 가 같은 캔들을 다시 쓴다 (같은 창이어야 두 판정이 같은 데이터 위에 선다) */
const candlesOf = new Map<string, Candle[]>()

for (const sym of SYMBOLS) {
  for (const tf of TFS) {
    const cs = await getCandles(sym, tf, 1000, END_TIME)
    candlesOf.set(`${sym} ${tf}`, cs)
    const counts: number[] = []
    for (const at of AT) {
      const active = activeSignalsAt(cs, at)
      counts.push(active.length)
      pooled.push(active.length)
      for (const s of active) tagHits.set(s.id, (tagHits.get(s.id) ?? 0) + 1)
    }
    series.push({ label: `${sym} ${tf}`, counts })
  }
}

// ── 계열별 분포와 판정 ───────────────────────────────────────────────────────

console.log(`\n=== 계열별 유효 근거 분포 (계열당 결정 시점 ${AT.length}개) ===`)
console.log(`데이터 창: ~${new Date(END_TIME * 1000).toISOString()} 까지 1000봉 (고정 — 재현 가능)`)
console.log(`${'계열'.padEnd(16)}${'최소'.padStart(6)}${'p25'.padStart(7)}${'중앙'.padStart(7)}${'p75'.padStart(7)}${'최대'.padStart(6)}   판정`)

const failed: string[] = []
for (const s of series) {
  const d = dist(s.counts)
  const ok = passes(d.median)
  if (!ok) failed.push(s.label)
  console.log(
    s.label.padEnd(16) +
    fmt(d.min).padStart(6) + fmt(d.p25).padStart(7) + fmt(d.median).padStart(7) +
    fmt(d.p75).padStart(7) + fmt(d.max).padStart(6) +
    `   ${ok ? 'PASS' : 'FAIL'}`,
  )
}

const pd = dist(pooled)
const pooledOk = passes(pd.median)
console.log('─'.repeat(56))
console.log(
  `풀링(${pd.n})`.padEnd(16) +
  fmt(pd.min).padStart(6) + fmt(pd.p25).padStart(7) + fmt(pd.median).padStart(7) +
  fmt(pd.p75).padStart(7) + fmt(pd.max).padStart(6) +
  `   ${pooledOk ? 'PASS' : 'FAIL'}`,
)

// 원자료 — 재계산으로 검증할 수 있게 남긴다
console.log(`\n=== 계열별 원자료 ===`)
for (const s of series) console.log(`${s.label.padEnd(16)} ${s.counts.join(', ')}`)

// ── 튜닝 근거: 태그별 출현 ──────────────────────────────────────────────────

console.log(`\n=== 태그별 유효 출현 (결정 시점 ${pooled.length}개, 총 ${[...tagHits.values()].reduce((a, b) => a + b, 0)}회) ===`)
const total = [...tagHits.values()].reduce((a, b) => a + b, 0)
for (const [id, n] of [...tagHits].sort((a, b) => b[1] - a[1])) {
  const lt = TAG_BY_ID.get(id)?.lifetime
  const share = total > 0 ? ((n / total) * 100).toFixed(1) : '0.0'
  console.log(`${id.padEnd(26)}${String(n).padStart(6)}${(share + '%').padStart(8)}   ${lt ? lifetimeLabel(lt) : '?'}`)
}

const never = TAGS.filter((t) => !tagHits.has(t.id)).map((t) => t.id)
console.log(`\n한 번도 유효하지 않은 태그 ${never.length}종: ${never.join(', ') || '없음'}`)

// ── 판정 ────────────────────────────────────────────────────────────────────

console.log(`\n=== 체크포인트 ① 게이트 판정 ===`)
console.log(`기준: 모든 계열의 중앙값이 ${MEDIAN_MIN}~${MEDIAN_MAX} 안에 들고, 풀링 중앙값도 그래야 한다.`)
console.log(`계열 ${series.length - failed.length}/${series.length} 통과, 풀링 중앙값 ${fmt(pd.median)} ${pooledOk ? '통과' : '실패'}`)

const gateOk = failed.length === 0 && pooledOk
if (gateOk) {
  console.log(`\n판정: PASS — 모든 계열과 풀링 중앙값이 ${MEDIAN_MIN}~${MEDIAN_MAX} 안에 있다.`)
} else {
  const why = [
    failed.length > 0 ? `계열 ${failed.length}개 미달/초과: ${failed.join(', ')}` : '',
    !pooledOk ? `풀링 중앙값 ${fmt(pd.median)}` : '',
  ].filter(Boolean).join(' / ')
  console.log(`\n판정: FAIL — ${why}`)
  // 읽기만 되고 믿을 수는 없는 튜닝 도구가 되지 않도록 종료 코드로도 알린다.
  // process.exit 대신 exitCode 를 쓴다 — 버퍼에 남은 출력이 잘리지 않게.
  process.exitCode = 1
}

// ════════════════════════════════════════════════════════════════════════════
// 위험 체크포인트 ②: 후보 밀도와 2단계 지름길의 무손실성
// ════════════════════════════════════════════════════════════════════════════
//
// 두 가지를 같이 본다. 밀도만 봐서는 부족하다 — 밀도가 목표 안에 들어도 그게 지름길이
// 후보를 흘려서 나온 숫자라면 계기판이 거짓말을 하는 것이다.
//
//   (1) 밀도: scanForSetups 가 1000봉에서 문제로 쓸 만한 결정 시점을 몇 개 찾는가.
//   (2) 무손실: 2단계 스캔 결과가 "모든 봉에 정확 경로를 돌린" 전수 스캔과 같은가.
//
// 1단계 임계값(minScore − COARSE_SLACK)은 증명이 아니라 실측으로 고른 값이라, 실데이터
// 에서 지름길이 실제로 같은 답을 내는지는 매번 다시 확인해야 한다.

const DENSITY_MIN = 15
const DENSITY_MAX = 40
// 2026-08-06 가중치 개정으로 배점 상한이 5 → 4 로 내려가 점수 분포 전체가 낮아졌다.
// 옛 확정값 125 는 이제 밀도 9.5 를 내므로 탐색 범위를 아래로 넓힌다.
const PROBE_MINS = [70, 75, 80, 85, 90, 95, 100, 105, 110, 120]

/**
 * 난이도 축이 정보를 갖는지의 기준. 한 계층이 10% 미만이면 그 난이도는 사실상 존재하지
 * 않는 것이고, 70%를 넘으면 난이도가 상수라 축이 아무 말도 못 한다.
 * (개수 기준 규칙이 easy 0.4% 로 무너졌던 것을 다시 놓치지 않기 위한 계기판이다.)
 */
const TIER_SHARE_MIN = 10
const TIER_SHARE_MAX = 70

/**
 * 지름길 없이 모든 봉에 정확 경로(activeSignalsAt)를 돌린 봉별 점수표와, 같은 봉에서
 * 1단계 근사가 얼마나 어긋나는지를 함께 잰다. 1000봉에 약 2초.
 *
 * 점수표는 (a) 임계값 스윕의 재료이자 (b) 2단계 스캐너를 채점할 기준 답안이다.
 *
 * **간극(gap)은 병합 전에, 봉 단위로 잰다.** 병합 뒤 후보만 비교하면 NMS 가 어차피
 * 억제했을 봉에서 일어난 누락이 보이지 않는다. 그런데 coarseFloor 를 넘지 못해
 * 떨어지는 봉은 정확 점수가 minScore 바로 위인 봉 — 즉 창 안에서 점수가 가장 낮아
 * NMS 가 버릴 가능성이 큰 봉이다. 실패가 몰리는 자리가 곧 병합 후 비교가 가장 둔한
 * 자리라, 병합 후 비교만으로는 COARSE_SLACK 을 회귀 검사할 수 없다.
 */
function measureSeries(cs: Candle[]): { rows: SetupCandidate[]; maxGap: number; minGap: number } {
  const all = detectAll(cs)
  const rows: SetupCandidate[] = []
  let maxGap = -Infinity
  let minGap = Infinity

  for (let i = WARMUP; i < cs.length; i++) {
    const active = activeSignalsAt(cs, i)
    const exact = setupScore(active)
    const coarse = setupScore(filterActive(cs, all, i))

    // gap > 0 : 1단계가 낮게 봤다(과소추정). COARSE_SLACK 이 막아야 하는 방향이다.
    // gap < 0 : 1단계가 높게 봤다(과대추정). setupScore 의 conflict 항이 단조가 아니라
    //           신호가 빠지면 min(bull,bear) 이 줄어 점수가 오르는 경우를 구성할 수는
    //           있다. 다만 실측에서는 한 번도 관측되지 않았다(아래 표의 '과대추정 최대'
    //           가 전부 0이면 그런 뜻이다). 관측되더라도 안전한 방향이다 — 후보를 넉넉히
    //           통과시킬 뿐이고 2단계가 정확 점수로 다시 걸러낸다. 게이트는 양의 꼬리만 본다.
    const gap = exact - coarse
    if (gap > maxGap) maxGap = gap
    if (gap < minGap) minGap = gap

    rows.push({
      barIndex: i,
      setupScore: exact,
      difficulty: difficultyOf(active),
      dominantSide: dominantSide(active),
      activeCount: active.length,
    })
  }
  return { rows, maxGap, minGap }
}

/** 전수 점수표에서 minScore 로 거르고 스캐너와 같은 병합을 적용한 기준 답안 */
const reference = (rows: SetupCandidate[], min: number): SetupCandidate[] =>
  mergeCandidates(rows.filter((r) => r.setupScore >= min), DEFAULT_MERGE_WINDOW)

/** 1000봉 환산 밀도 — 계열마다 봉 수가 다를 수 있으므로 개수를 그대로 비교하지 않는다 */
const per1000 = (n: number, bars: number) => (n * 1000) / bars

type DensitySeries = {
  label: string; bars: number; rows: SetupCandidate[]
  /** 전수 스캔에는 있는데 2단계 스캔이 놓친 후보 수 */
  lost: number
  /** 2단계 스캔에는 있는데 전수 스캔에는 없는 후보 수 */
  extra: number
  /** 봉 단위 과소추정 최대 (양수). COARSE_SLACK 이 덮어야 하는 값이다 */
  maxGap: number
  /** 봉 단위 과대추정 최대 (음수). 정보용이며 실패 조건이 아니다 */
  minGap: number
}

console.log(`\n\n=== 후보 밀도 측정 (계열마다 전수 정확 스캔 1회) ===`)
const dseries: DensitySeries[] = []
for (const [label, cs] of candlesOf) {
  const t = Date.now()
  const { rows, maxGap, minGap } = measureSeries(cs)
  const fast = scanForSetups(cs, { minScore: DEFAULT_MIN_SCORE, mergeWindow: DEFAULT_MERGE_WINDOW })
  const ref = reference(rows, DEFAULT_MIN_SCORE)
  // 후보는 필드 전부가 같아야 한다 — barIndex 만 맞고 점수·난이도가 다르면 그것도 불일치다.
  const fastKeys = new Set(fast.map((c) => JSON.stringify(c)))
  const refKeys = new Set(ref.map((c) => JSON.stringify(c)))
  const lost = [...refKeys].filter((k) => !fastKeys.has(k)).length
  const extra = [...fastKeys].filter((k) => !refKeys.has(k)).length
  dseries.push({ label, bars: cs.length, rows, lost, extra, maxGap, minGap })
  console.log(`  ${label.padEnd(14)} 전수 ${String(Date.now() - t).padStart(5)}ms  후보 ${String(fast.length).padStart(3)}개`)
}

// ── minScore 스윕 ───────────────────────────────────────────────────────────

const shortLabel = (s: string) => s.replace('USDT', '')

console.log(`\n=== minScore 스윕 (1000봉 환산 밀도, mergeWindow ${DEFAULT_MERGE_WINDOW}) ===`)
console.log(
  'min'.padStart(5) + dseries.map((s) => shortLabel(s.label).padStart(9)).join('') +
  '평균'.padStart(8) + '최소'.padStart(6) + '최대'.padStart(6) + '여유'.padStart(6) + '  판정',
)
for (const m of PROBE_MINS) {
  const ds = dseries.map((s) => per1000(reference(s.rows, m).length, s.bars))
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length
  const lo = Math.min(...ds)
  const hi = Math.max(...ds)
  // 게이트 양쪽 경계까지의 최소 여유. 이 값이 가장 큰 행이 가장 안전한 임계값이다.
  const margin = Math.min(lo - DENSITY_MIN, DENSITY_MAX - hi)
  const mark = m === DEFAULT_MIN_SCORE ? ' ←기본값' : ''
  console.log(
    String(m).padStart(5) + ds.map((d) => fmt(d).padStart(9)).join('') +
    avg.toFixed(1).padStart(8) + fmt(lo).padStart(6) + fmt(hi).padStart(6) + fmt(margin).padStart(6) +
    `  ${lo >= DENSITY_MIN && hi <= DENSITY_MAX ? 'PASS' : 'FAIL'}${mark}`,
  )
}

// ── 기본 임계값에서의 계열별 판정 ────────────────────────────────────────────

console.log(`\n=== 기본값 minScore ${DEFAULT_MIN_SCORE} · mergeWindow ${DEFAULT_MERGE_WINDOW} 에서의 계열별 판정 ===`)
console.log(
  `${'계열'.padEnd(14)}${'후보'.padStart(6)}${'밀도'.padStart(7)}${'점수중앙'.padStart(10)}` +
  `${'easy'.padStart(6)}${'med'.padStart(5)}${'hard'.padStart(6)}${'지름길'.padStart(10)}   판정`,
)

const densityFailed: string[] = []
const shortcutFailed: string[] = []
let totalCandidates = 0
let totalBars = 0
const tierCount: Record<string, number> = { easy: 0, medium: 0, hard: 0 }

for (const s of dseries) {
  const cand = reference(s.rows, DEFAULT_MIN_SCORE)
  const density = per1000(cand.length, s.bars)
  totalCandidates += cand.length
  totalBars += s.bars

  const sd = dist(cand.map((c) => c.setupScore))
  const mix = (d: string) => cand.filter((c) => c.difficulty === d).length
  for (const d of ['easy', 'medium', 'hard']) tierCount[d] += mix(d)
  const densityOk = density >= DENSITY_MIN && density <= DENSITY_MAX
  const shortcutOk = s.lost === 0 && s.extra === 0
  if (!densityOk) densityFailed.push(s.label)
  if (!shortcutOk) shortcutFailed.push(`${s.label}(누락 ${s.lost}/여분 ${s.extra})`)

  console.log(
    s.label.padEnd(14) + String(cand.length).padStart(6) + fmt(density).padStart(7) +
    fmt(sd.median).padStart(10) + String(mix('easy')).padStart(6) + String(mix('medium')).padStart(5) +
    String(mix('hard')).padStart(6) + (shortcutOk ? '일치' : '불일치').padStart(10) +
    `   ${densityOk && shortcutOk ? 'PASS' : 'FAIL'}`,
  )
}

const pooledDensity = per1000(totalCandidates, totalBars)
const pooledDensityOk = pooledDensity >= DENSITY_MIN && pooledDensity <= DENSITY_MAX
console.log('─'.repeat(70))
console.log(
  `풀링(${dseries.length}계열)`.padEnd(14) + String(totalCandidates).padStart(6) +
  fmt(Number(pooledDensity.toFixed(1))).padStart(7) + '—'.padStart(10) + '—'.padStart(6) +
  '—'.padStart(5) + '—'.padStart(6) + (shortcutFailed.length === 0 ? '일치' : '불일치').padStart(10) +
  `   ${pooledDensityOk && shortcutFailed.length === 0 ? 'PASS' : 'FAIL'}`,
)

// ── 1단계 과소추정 폭 (COARSE_SLACK 회귀 검사) ──────────────────────────────
//
// 이 표가 shipped 상수 COARSE_SLACK 이 실제로 기대는 측정이다. 병합이 끼지 않은
// 봉 단위 비교라, 어느 봉에서 어긋나든 반드시 여기 잡힌다.

console.log(`\n=== 1단계 근사 오차 (봉 단위, 병합 전) · COARSE_SLACK = ${COARSE_SLACK} ===`)
console.log(
  `${'계열'.padEnd(14)}${'과소추정 최대'.padStart(14)}${'여유'.padStart(7)}` +
  `${'과대추정 최대'.padStart(14)}   판정`,
)

const gapFailed: string[] = []
let worstGap = -Infinity
let worstNegGap = Infinity
for (const s of dseries) {
  const gapOk = s.maxGap < COARSE_SLACK
  if (!gapOk) gapFailed.push(`${s.label}(${s.maxGap})`)
  if (s.maxGap > worstGap) worstGap = s.maxGap
  if (s.minGap < worstNegGap) worstNegGap = s.minGap
  console.log(
    s.label.padEnd(14) + String(s.maxGap).padStart(14) + String(COARSE_SLACK - s.maxGap).padStart(7) +
    String(s.minGap).padStart(14) + `   ${gapOk ? 'PASS' : 'FAIL'}`,
  )
}
console.log('─'.repeat(56))
console.log(
  '전 계열'.padEnd(14) + String(worstGap).padStart(14) + String(COARSE_SLACK - worstGap).padStart(7) +
  String(worstNegGap).padStart(14) + `   ${gapFailed.length === 0 ? 'PASS' : 'FAIL'}`,
)
console.log(
  `\n과소추정(양수)만 위험하다 — 1단계가 낮게 봐서 후보가 coarseFloor 밑으로 떨어지는 방향이다.\n` +
  `과대추정(음수)은 setupScore 의 conflict 항이 단조가 아니라 이론상 가능하지만 위 표대로\n` +
  `한 번도 관측되지 않았다(전부 0). 관측되더라도 후보를 넉넉히 통과시킬 뿐 2단계가 정확\n` +
  `점수로 다시 거르므로 안전하다. 그래서 게이트는 양의 꼬리만 본다.`,
)

// ── 난이도 계층 분포 ────────────────────────────────────────────────────────
//
// 난이도가 한 값에 쏠려 있으면 그 축은 문제 배분에도 사용자 안내에도 쓸모가 없다.
// 개수 기준 규칙이 easy 0.4% 로 사실상 죽어 있던 것을 놓쳤던 자리라 계기판을 붙여 둔다.

console.log(`\n=== 난이도 계층 분포 (후보 ${totalCandidates}개) ===`)
console.log(`${'계층'.padEnd(10)}${'개수'.padStart(7)}${'비율'.padStart(8)}   판정`)
const tierFailed: string[] = []
for (const d of ['easy', 'medium', 'hard']) {
  const share = (tierCount[d] / totalCandidates) * 100
  const tierOk = share >= TIER_SHARE_MIN && share <= TIER_SHARE_MAX
  if (!tierOk) tierFailed.push(`${d} ${share.toFixed(1)}%`)
  console.log(
    d.padEnd(10) + String(tierCount[d]).padStart(7) + `${share.toFixed(1)}%`.padStart(8) +
    `   ${tierOk ? 'PASS' : 'FAIL'}`,
  )
}

// ── 판정 ────────────────────────────────────────────────────────────────────

console.log(`\n=== 체크포인트 ② 게이트 판정 ===`)
console.log(`기준 1(밀도): 모든 계열과 풀링이 1000봉당 ${DENSITY_MIN}~${DENSITY_MAX}개.`)
console.log(`기준 2(무손실): 2단계 스캔 결과가 전수 정확 스캔과 후보 필드까지 완전히 같아야 한다.`)
console.log(`기준 3(근사 오차): 봉 단위 과소추정 최대가 COARSE_SLACK(${COARSE_SLACK}) 미만이어야 한다.`)
console.log(`기준 4(난이도): 어떤 계층도 ${TIER_SHARE_MIN}% 미만이거나 ${TIER_SHARE_MAX}% 초과가 아니어야 한다.`)
console.log(
  `계열 ${dseries.length - new Set([...densityFailed, ...shortcutFailed.map((s) => s.split('(')[0])]).size}` +
  `/${dseries.length} 통과, 풀링 밀도 ${pooledDensity.toFixed(1)} ${pooledDensityOk ? '통과' : '실패'}`,
)

const densityGateOk = densityFailed.length === 0 && shortcutFailed.length === 0 &&
  pooledDensityOk && gapFailed.length === 0 && tierFailed.length === 0
if (densityGateOk) {
  console.log(
    `\n판정: PASS — 계열별 밀도가 전부 ${DENSITY_MIN}~${DENSITY_MAX} 안에 있고, ` +
    `2단계 지름길이 전수 정확 스캔과 한 건도 어긋나지 않으며, ` +
    `과소추정 최대 ${worstGap} < COARSE_SLACK ${COARSE_SLACK} (여유 ${COARSE_SLACK - worstGap}), ` +
    `난이도 세 계층이 모두 살아 있다.`,
  )
} else {
  const why = [
    densityFailed.length > 0 ? `밀도 이탈 계열: ${densityFailed.join(', ')}` : '',
    shortcutFailed.length > 0 ? `지름길 불일치: ${shortcutFailed.join(', ')}` : '',
    !pooledDensityOk ? `풀링 밀도 ${pooledDensity.toFixed(1)}` : '',
    gapFailed.length > 0
      ? `과소추정이 COARSE_SLACK(${COARSE_SLACK}) 이상인 계열: ${gapFailed.join(', ')} — 상수를 올려야 한다`
      : '',
    tierFailed.length > 0 ? `난이도 계층 쏠림: ${tierFailed.join(', ')}` : '',
  ].filter(Boolean).join(' / ')
  console.log(`\n판정: FAIL — ${why}`)
  process.exitCode = 1
}

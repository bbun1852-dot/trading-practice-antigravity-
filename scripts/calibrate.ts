import { getCandles } from '../src/data/fileCache'
import { activeSignalsAt } from '../src/quiz/lifetime'
import { TAGS, TAG_BY_ID, type LifetimeClass } from '../src/quiz/taxonomy'
import type { Timeframe } from '../src/data/types'

/**
 * 위험 체크포인트 ①: 결정 시점 하나가 내놓는 "유효 근거" 개수가 사람이 실제로
 * 짚을 수 있는 규모인지 실측한다. 너무 많으면 채점이 "이것도 놓쳤다" 로 도배되고,
 * 너무 적으면 채점이 아무 말도 못 한다.
 *
 * **게이트: 모든 심볼×타임프레임 계열의 중앙값이 8~15 안에 들고, 풀링 중앙값도 그래야 한다.**
 * 계열별이 실질 판정이다 — 이 도구의 약속은 "당신이 띄운 차트에서 동작한다" 이지
 * "차트 열 개 평균에서 동작한다" 가 아니다. 한 계열이라도 벗어나면 게이트 실패이고
 * 이 스크립트는 0이 아닌 코드로 끝난다.
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

for (const sym of SYMBOLS) {
  for (const tf of TFS) {
    const cs = await getCandles(sym, tf, 1000, END_TIME)
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

console.log(`\n=== 게이트 판정 ===`)
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

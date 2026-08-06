import { getCandles } from '../src/data/fileCache'
import { activeSignalsAt } from '../src/quiz/lifetime'
import { TAGS } from '../src/quiz/taxonomy'
import type { Timeframe } from '../src/data/types'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT']
const TFS: Timeframe[] = ['4h', '1d']
/** 결정 시점 표본. 워밍업 120봉을 지난 지점들 */
const AT = [200, 300, 400, 500, 600, 700, 800, 900]

const counts: number[] = []
const tagHits = new Map<string, number>()

for (const sym of SYMBOLS) {
  for (const tf of TFS) {
    const cs = await getCandles(sym, tf, 1000)
    const local: number[] = []
    for (const at of AT) {
      const active = activeSignalsAt(cs, at)
      local.push(active.length)
      counts.push(active.length)
      for (const s of active) tagHits.set(s.id, (tagHits.get(s.id) ?? 0) + 1)
    }
    console.log(`${sym} ${tf}: 유효 근거 ${local.join(', ')}`)
  }
}

const sorted = [...counts].sort((a, b) => a - b)
const pct = (p: number) => sorted[Math.floor(sorted.length * p)]
console.log(`\n=== 유효 근거 분포 (표본 ${counts.length}개) ===`)
console.log(`최소 ${sorted[0]} / p25 ${pct(0.25)} / 중앙 ${pct(0.5)} / p75 ${pct(0.75)} / 최대 ${sorted[sorted.length - 1]}`)
console.log(`목표: 중앙값 8~15`)

console.log(`\n=== 태그별 유효 출현 (표본 ${counts.length}시점) ===`)
for (const [id, n] of [...tagHits].sort((a, b) => b[1] - a[1])) {
  console.log(`${id.padEnd(26)} ${n}`)
}

const never = TAGS.filter((t) => !tagHits.has(t.id)).map((t) => t.id)
console.log(`\n한 번도 유효하지 않은 태그 ${never.length}종: ${never.join(', ') || '없음'}`)

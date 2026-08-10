import { getCandles } from '../src/data/fileCache'
import { scanForSetups } from '../src/quiz/scanner'
import { makeQuestion } from '../src/quiz/generator'
import { activeSignalsAt } from '../src/quiz/lifetime'
import { grade } from '../src/quiz/grader'
import { toMarkdown } from '../src/quiz/report'
import { TAG_BY_ID } from '../src/quiz/taxonomy'
import type { Answer } from '../src/quiz/types'

const symbol = process.argv[2] ?? 'BTCUSDT'
const cs = await getCandles(symbol, '4h', 1000)

const candidates = scanForSetups(cs)
console.log(`후보 ${candidates.length}개`)
if (candidates.length === 0) {
  console.error('후보가 없다. scanner 의 minScore 를 확인할 것.')
  process.exit(1)
}

let q;
for (let i = Math.floor(candidates.length / 2); i < candidates.length; i++) {
  const cand = candidates[i];
  q = makeQuestion(cs, symbol, '4h', cand);
  if (q) break;
}
if (!q) {
  for (let i = Math.floor(candidates.length / 2) - 1; i >= 0; i--) {
    const cand = candidates[i];
    q = makeQuestion(cs, symbol, '4h', cand);
    if (q) break;
  }
}
if (!q) {
  console.error('창을 확보할 수 없다.')
  process.exit(1)
}

// 사용자에게 보이는 것: 마스킹된 문제
console.log(`\n=== 문제 ===`)
console.log(`${symbol} / ${q.timeframe} / ${q.difficulty}`)
console.log(`노출 ${q.decisionIndex + 1}봉, 은닉 ${q.candles.length - q.decisionIndex - 1}봉`)
console.log(`마지막 종가 ${q.candles[q.decisionIndex].close}`)

// 유효 근거를 사람이 읽을 수 있게 나열한다
const active = activeSignalsAt(q.candles.slice(0, q.decisionIndex + 1), q.decisionIndex)
console.log(`\n=== 유효 근거 ${active.length}개 ===`)
for (const s of active) {
  console.log(`  [T${s.tier} s${s.strength} ${s.ageBars}봉전] ${TAG_BY_ID.get(s.id)?.label ?? s.id} — ${s.evidence}`)
}

// 가짜 답안: 유효 근거 중 둘을 맞히고 하나는 헛다리
const answer: Answer = {
  direction: 'long',
  entry: q.candles[q.decisionIndex].close,
  stopLoss: q.candles[q.decisionIndex].close * 0.97,
  takeProfit: q.candles[q.decisionIndex].close * 1.06,
  tags: [...active.slice(0, 2).map((s) => s.id), 'liq_sweep_high'],
}

console.log(`\n=== 채점 리포트 ===\n`)
console.log(toMarkdown(q, answer, grade(q, answer)))

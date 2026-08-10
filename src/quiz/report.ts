import type { Answer, GradeReport, Question } from './types'
import { TAG_BY_ID } from './taxonomy'
import { revealed } from './generator'

const label = (id: string) => TAG_BY_ID.get(id)?.label ?? id

/** 채점 결과를 사용자의 기존 오답노트와 같은 형식의 마크다운으로 낸다 (스펙 8절) */
export function toMarkdown(q: Question, a: Answer, r: GradeReport): string {
  const rev = revealed(q)
  const when = new Date(rev.time * 1000).toISOString().slice(0, 16).replace('T', ' ')
  const L: string[] = []

  L.push(`## ${rev.symbol} ${q.timeframe} (${when}) — ${q.type} / ${q.difficulty}`)
  L.push('')
  L.push(`**내 판단:** ${a.direction}` +
    (a.entry !== undefined ? ` / 진입 ${a.entry} / 손절 ${a.stopLoss} / 익절 ${a.takeProfit ?? '-'}` : ''))
  L.push(`**정답 방향:** ${r.direction.correct}`)
  
  const resultStr = r.replay 
    ? `${r.replay.exit} ${r.replay.r.toFixed(2)}R`
    : '불성립 주문 (실행 불가)'

  L.push(`**결과:** ${resultStr}  |  ` +
    `프로세스 ${r.processScore}점 / 결과 ${r.outcomeScore}점 / 총 ${r.totalScore}점`)
  L.push('')

  L.push('### 내가 본 근거')
  if (r.evidence.verdict.hits.length === 0 && r.evidence.verdict.falseClaims.length === 0) {
    L.push('- (없음)')
  }
  for (const t of r.evidence.verdict.hits) L.push(`- ✅ ${label(t)}`)
  for (const t of r.evidence.verdict.falseClaims) L.push(`- ❌ ${label(t)} — 그 시점에 존재하지 않았다`)
  L.push('')

  L.push('### 놓친 것')
  if (r.evidence.verdict.coreMisses.length === 0) L.push('- (없음)')
  for (const t of r.evidence.verdict.coreMisses) L.push(`- ⚠️ ${label(t)}`)
  L.push('')

  if (r.evidence.verdict.reference.length > 0) {
    L.push('### 참고 — 이것도 있었습니다 (감점 없음)')
    for (const t of r.evidence.verdict.reference) L.push(`- 📋 ${label(t)}`)
    L.push('')
  }

  L.push('### 실행')
  for (const n of r.execution.notes) L.push(`- ${n}`)
  L.push('')

  L.push('### 판정')
  L.push(r.judgement)

  return L.join('\n')
}

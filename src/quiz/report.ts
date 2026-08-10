import type { Answer, GradeReport, Question } from './types'
import { TAG_BY_ID } from './taxonomy'
import { revealed } from './generator'
import { DIRECTION_MAX } from './grader'

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

  // 관망의 replay 는 null 이 아니라 NONE 센티넬(exit:'none', r:0)이다 — grade() 가
  // 관망을 orderValid=true 로 보기 때문이다. 그대로 찍으면 헤더가 "none 0.00R" 이
  // 되어, 바로 아래 judgement 의 "체결도 손익도 없습니다" 와 한 문서 안에서 충돌한다.
  const resultStr = !r.replay
    ? '불성립 주문 (실행 불가)'
    : a.direction === 'flat' ? '관망 — 체결 없음'
    : !r.replay.filled ? '미체결'
    : `${r.replay.exit} ${r.replay.r.toFixed(2)}R`

  // 분모를 함께 적는다. 관망이면 실행 축이 판정에서 빠져 applicableMax 가 60 이고
  // totalScore 는 거기서 100점으로 환산된 값이라, 분모 없이는 앞의 두 수와 합이 맞지
  // 않고(0 + 30 인데 총 50) 고정 100점 만점으로도 오독된다 (types.ts 의 applicableMax).
  const scaleNote = r.applicableMax === 100 ? '' : ` (${r.applicableMax}점 만점 환산)`
  L.push(`**결과:** ${resultStr}  |  ` +
    `프로세스 ${r.processScore}/${r.processMax} · 결과 ${r.outcomeScore}/${DIRECTION_MAX} · ` +
    `총 ${r.totalScore}/100${scaleNote}`)
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

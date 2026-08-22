import { useMemo, useState } from 'react'
import { HIGHER_TF } from '../../data/types'
import { activeSignalsAt } from '../../quiz/lifetime'
import { ruleCheck } from '../../quiz/ruleCheck'
import { TAG_BY_ID } from '../../quiz/taxonomy'
import { CandleChart } from '../chart/CandleChart'
import { toShapes } from '../chart/overlay'
import { useQuizStore } from '../store'

export function ReviewScreen() {
  const question = useQuizStore((s) => s.question)
  const report = useQuizStore((s) => s.report)
  const next = useQuizStore((s) => s.next)
  const draft = useQuizStore((s) => s.draft)

  const [overlayFilter, setOverlayFilter] = useState<'all' | 'hits_misses' | 'none'>('hits_misses')
  const [showRulePanel, setShowRulePanel] = useState(false)

  const { shapes, ruleResult } = useMemo(() => {
    if (!question) return { shapes: [], ruleResult: null }
    const visible = question.candles.slice(0, question.decisionIndex + 1)
    const activeSigs = activeSignalsAt(
      visible, question.decisionIndex, question.timeframe,
      question.htfCandles, HIGHER_TF[question.timeframe],
    )
    return {
      shapes: toShapes(activeSigs, question.candles),
      ruleResult: ruleCheck(activeSigs, question.timeframe)
    }
  }, [question])

  if (!question || !report || !ruleResult) return null

  // Filter shapes based on UI toggle (R1/R2/R3 checks are implicit in what report has)
  const visibleShapes = shapes.filter(s => {
    if (overlayFilter === 'none') return false
    if (overlayFilter === 'all') return true
    // 'hits_misses' -> only hits and core misses
    const isHit = report.evidence.verdict.hits.includes(s.id)
    const isMiss = report.evidence.verdict.coreMisses.includes(s.id)
    return isHit || isMiss
  })

  return (
    <div className="review">
      <section className="chart-area">
        <div className="chart-caption">
          <span>총점: {report.totalScore} / {report.applicableMax}</span>
          {report.execution.max > 0 && (
            <span> · 실행: {report.execution.score}/{report.execution.max}</span>
          )}
          <span> · 방향: {report.direction.score}/30</span>
          <span> · 근거: {report.evidence.score}/30</span>
          <span>
            {' · '}
            {report.replay === null ? '주문 불성립' : `결과: ${report.outcomeScore}점 (R·PnL: ${report.replay.r.toFixed(2)}R)`}
          </span>
          
          <select value={overlayFilter} onChange={e => setOverlayFilter(e.target.value as any)}>
            <option value="hits_misses">✅맞힘 + ⚠️핵심 놓침</option>
            <option value="all">모든 근거 표시</option>
            <option value="none">숨기기</option>
          </select>
        </div>
        <CandleChart className="chart-canvas" candles={question.candles} overlays={visibleShapes} />
      </section>
      
      <aside className="side-area review-sidebar">
        <div className="verdict-summary">
          {report.evidence.verdict.hits.length > 0 && (
            <div><strong>✅ 맞힘:</strong> {report.evidence.verdict.hits.map(id => TAG_BY_ID.get(id)?.label).join(', ')}</div>
          )}
          {report.evidence.verdict.falseClaims.length > 0 && (
            <div><strong>❌ 헛다리:</strong> {report.evidence.verdict.falseClaims.map(id => TAG_BY_ID.get(id)?.label).join(', ')}</div>
          )}
          {report.evidence.verdict.coreMisses.length > 0 && (
            <div><strong>⚠️ 핵심 놓침:</strong> {report.evidence.verdict.coreMisses.map(id => TAG_BY_ID.get(id)?.label).join(', ')}</div>
          )}
          {report.evidence.verdict.reference.length > 0 && (
            <div><strong>📋 참고:</strong> {report.evidence.verdict.reference.map(id => TAG_BY_ID.get(id)?.label).join(', ')}</div>
          )}
        </div>

        <div style={{ marginTop: '20px' }}>
          <button 
            className="secondary" 
            onClick={() => setShowRulePanel(!showRulePanel)}
            style={{ width: '100%' }}
          >
            {showRulePanel ? '34점 룰 분석 숨기기' : '34점 룰 분석 (My Setup) 보기'}
          </button>
        </div>

        {showRulePanel && (
          <div className="rule-panel" style={{ marginTop: '16px' }}>
            <h3>34점 패널 (정답 기준)</h3>
            {ruleResult.rows.map(r => (
              <div key={r.key} className={`rule-row ${r.state}`}>
                {r.core && <span>[핵심] </span>}{r.label}: {r.state} ({r.points}점)
                {r.matched.length > 0 && <div className="matched-tags">{r.matched.map(id => TAG_BY_ID.get(id)?.label).join(', ')}</div>}
              </div>
            ))}
          </div>
        )}
      </aside>

      <footer className="answer-bar">
        <textarea 
          placeholder="복기 메모 (선택)" 
          value={draft.memo}
          onChange={(e) => useQuizStore.getState().setMemo(e.target.value)}
        />
        <span className="spacer" />
        <button className="primary" onClick={next}>다음 문제</button>
      </footer>
    </div>
  )
}

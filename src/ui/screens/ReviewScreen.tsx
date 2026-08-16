/**
 * 복기 화면 — 채점 리포트·34점 패널·오버레이 토글은 Task 7 이 채운다.
 * 지금은 **근거 오버레이만** 그린다 (Task 5 의 눈검증 대상).
 *
 * 은닉 규율 U2: 근거 계산은 answering 이 아니라 여기서만 한다. 이 화면은 답을
 * 이미 제출한 뒤에만 열리므로 `question` 을 읽어도 된다.
 */
import { useMemo } from 'react'
import { HIGHER_TF } from '../../data/types'
import { activeSignalsAt } from '../../quiz/lifetime'
import { CandleChart } from '../chart/CandleChart'
import { toShapes } from '../chart/overlay'
import { useQuizStore } from '../store'

export function ReviewScreen() {
  const question = useQuizStore((s) => s.question)
  const draft = useQuizStore((s) => s.draft)
  const next = useQuizStore((s) => s.next)

  const shapes = useMemo(() => {
    if (!question) return []
    const visible = question.candles.slice(0, question.decisionIndex + 1)
    const active = activeSignalsAt(
      visible, question.decisionIndex, question.timeframe,
      question.htfCandles, HIGHER_TF[question.timeframe],
    )
    return toShapes(active, question.candles)
  }, [question])

  if (!question) return null

  return (
    <div className="review">
      <section className="chart-area">
        <div className="chart-caption">
          복기 (Task 7 에서 채점 리포트가 붙는다) · 근거 {shapes.length}개 ·
          제출 {draft.direction === 'long' ? '롱' : draft.direction === 'short' ? '숏' : '관망'} ·
          체크 {draft.tags.size}개
        </div>
        <CandleChart className="chart-canvas" candles={question.candles} overlays={shapes} />
      </section>
      <footer className="answer-bar">
        <span className="spacer" />
        <button className="primary" onClick={next}>다음 문제</button>
      </footer>
    </div>
  )
}

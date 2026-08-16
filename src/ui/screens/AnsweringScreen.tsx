/**
 * 풀이 화면 껍데기 — 배치는 스펙 §5.1. 차트는 Task 5, 태그 시트는 Task 6 이 채운다.
 *
 * **U1: 이 화면(과 하위 컴포넌트)은 store 의 `view` 만 읽는다. `question` 금지.**
 */
import { CandleChart } from '../chart/CandleChart'
import { useQuizStore } from '../store'

export function AnsweringScreen() {
  const view = useQuizStore((s) => s.view)
  const draft = useQuizStore((s) => s.draft)
  const setDirection = useQuizStore((s) => s.setDirection)
  const submit = useQuizStore((s) => s.submit)

  if (!view) return null
  const last = view.candles[view.candles.length - 1]

  return (
    <div className="answering">
      <section className="chart-area">
        <div className="chart-caption" data-view-info>
          {view.timeframe} · {view.difficulty} · 봉 {view.candles.length}개 · 마지막 종가 {last.close}
        </div>
        <CandleChart className="chart-canvas" candles={view.candles} />
      </section>
      <aside className="side-area">
        {view.htfCandles.length > 0
          ? <CandleChart className="htf" candles={view.htfCandles} compact />
          : <div className="placeholder htf">상위 TF 봉 없음</div>}
        <div className="placeholder sheet">34점 시트 자리 (Task 6) · 선택 {draft.tags.size}개</div>
      </aside>
      <footer className="answer-bar">
        <div className="direction" role="radiogroup" aria-label="방향">
          {(['long', 'short', 'flat'] as const).map((d) => (
            <label key={d}>
              <input
                type="radio"
                name="direction"
                checked={draft.direction === d}
                onChange={() => setDirection(d)}
              />
              {d === 'long' ? '롱' : d === 'short' ? '숏' : '관망'}
            </label>
          ))}
        </div>
        <span className="spacer" />
        <button className="primary" disabled={draft.direction === null} onClick={submit}>
          제출
        </button>
      </footer>
    </div>
  )
}

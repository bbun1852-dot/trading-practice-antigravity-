/**
 * 풀이 화면 껍데기 — 배치는 스펙 §5.1. 차트는 Task 5, 태그 시트는 Task 6 이 채운다.
 *
 * **U1: 이 화면(과 하위 컴포넌트)은 store 의 `view` 만 읽는다. `question` 금지.**
 */
import { CandleChart } from '../chart/CandleChart'
import { useQuizStore } from '../store'
import { TagSheet } from './TagSheet'

export function AnsweringScreen() {
  const view = useQuizStore((s) => s.view)
  const draft = useQuizStore((s) => s.draft)
  const setDirection = useQuizStore((s) => s.setDirection)
  const setOrder = useQuizStore((s) => s.setOrder)
  const submit = useQuizStore((s) => s.submit)

  const drawingTool = useQuizStore((s) => s.drawingTool)
  const setDrawingTool = useQuizStore((s) => s.setDrawingTool)
  const clearDrawings = useQuizStore((s) => s.clearDrawings)

  if (!view) return null
  const last = view.candles[view.candles.length - 1]

  return (
    <div className="answering">
      <section className="chart-area">
        <div className="chart-caption" data-view-info style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {view.timeframe} · {view.difficulty} · 봉 {view.candles.length}개 · 마지막 종가 {last.close}
          </div>
          <div className="drawing-toolbar" style={{ display: 'flex', gap: '8px' }}>
            <button 
              className={drawingTool === null ? 'primary' : 'secondary'} 
              onClick={() => setDrawingTool(null)}
              style={{ padding: '2px 8px', fontSize: '12px' }}>선택(이동)
            </button>
            <button 
              className={drawingTool === 'trendline' ? 'primary' : 'secondary'} 
              onClick={() => setDrawingTool('trendline')}
              style={{ padding: '2px 8px', fontSize: '12px' }}>추세선
            </button>
            <button 
              className={drawingTool === 'ray' ? 'primary' : 'secondary'} 
              onClick={() => setDrawingTool('ray')}
              style={{ padding: '2px 8px', fontSize: '12px' }}>레이
            </button>
            <button 
              className={drawingTool === 'fibonacci' ? 'primary' : 'secondary'} 
              onClick={() => setDrawingTool('fibonacci')}
              style={{ padding: '2px 8px', fontSize: '12px' }}>피보나치
            </button>
            <button 
              className="secondary" 
              onClick={() => clearDrawings()}
              style={{ padding: '2px 8px', fontSize: '12px' }}>지우기
            </button>
          </div>
        </div>
        <CandleChart className="chart-canvas" candles={view.candles} />
      </section>
      <aside className="side-area">
        {view.htfCandles.length > 0
          ? <CandleChart className="htf" candles={view.htfCandles} compact />
          : <div className="placeholder htf">상위 TF 봉 없음</div>}
        <TagSheet timeframe={view.timeframe} />
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
        <div className="order-inputs">
          <label>
            진입
            <input
              type="number"
              value={draft.entry ?? ''}
              onChange={(e) => setOrder({ entry: e.target.value ? Number(e.target.value) : undefined })}
              disabled={draft.direction === 'flat' || draft.direction === null}
            />
          </label>
          <label>
            손절
            <input
              type="number"
              value={draft.stopLoss ?? ''}
              onChange={(e) => setOrder({ stopLoss: e.target.value ? Number(e.target.value) : undefined })}
              disabled={draft.direction === 'flat' || draft.direction === null}
            />
          </label>
          <label>
            익절
            <input
              type="number"
              value={draft.takeProfit ?? ''}
              onChange={(e) => setOrder({ takeProfit: e.target.value ? Number(e.target.value) : undefined })}
              disabled={draft.direction === 'flat' || draft.direction === null}
            />
          </label>
        </div>
        <span className="spacer" />
        <button className="primary" disabled={draft.direction === null} onClick={submit}>
          제출
        </button>
      </footer>
    </div>
  )
}

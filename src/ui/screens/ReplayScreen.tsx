/**
 * 재생 화면 껍데기 — 실제 차트 재생(U3: 봉 하나씩 추가)은 Task 7 이 붙인다.
 * 골격에서는 타이머가 store 의 replayTick 을 돌려 상태 머신만 실증한다.
 */
import { useEffect, useMemo } from 'react'
import { hiddenCount, useQuizStore } from '../store'
import { CandleChart } from '../chart/CandleChart'

export function ReplayScreen() {
  const question = useQuizStore((s) => s.question)
  const revealed = useQuizStore((s) => s.replay.revealed)
  const replayTick = useQuizStore((s) => s.replayTick)
  const replayDone = useQuizStore((s) => s.replayDone)

  const cap = question ? hiddenCount(question) : 0

  useEffect(() => {
    const timer = setInterval(replayTick, 50)
    return () => clearInterval(timer)
  }, [replayTick])

  useEffect(() => {
    if (cap > 0 && revealed >= cap) replayDone()
  }, [revealed, cap, replayDone])

  const currentCandles = useMemo(() => {
    if (!question) return []
    return question.candles.slice(0, question.decisionIndex + 1 + revealed)
  }, [question, revealed])

  if (!question) return null

  return (
    <div className="replay-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header className="replay-header" style={{ padding: '8px 16px', display: 'flex', gap: '16px', alignItems: 'center', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
        <h2>결과 재생중</h2>
        <progress value={revealed} max={cap} style={{ flex: 1, height: '8px' }} />
        <span style={{ fontSize: '14px', color: 'var(--text-dim)' }}>{revealed} / {cap} 봉</span>
        <button onClick={replayDone}>건너뛰기 (스킵)</button>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CandleChart className="chart-canvas" candles={currentCandles} />
      </div>
    </div>
  )
}

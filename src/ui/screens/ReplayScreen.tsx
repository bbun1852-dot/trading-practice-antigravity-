/**
 * 재생 화면 껍데기 — 실제 차트 재생(U3: 봉 하나씩 추가)은 Task 7 이 붙인다.
 * 골격에서는 타이머가 store 의 replayTick 을 돌려 상태 머신만 실증한다.
 */
import { useEffect } from 'react'
import { hiddenCount, useQuizStore } from '../store'

export function ReplayScreen() {
  const question = useQuizStore((s) => s.question)
  const revealed = useQuizStore((s) => s.replay.revealed)
  const replayTick = useQuizStore((s) => s.replayTick)
  const replayDone = useQuizStore((s) => s.replayDone)

  const cap = question ? hiddenCount(question) : 0

  useEffect(() => {
    const timer = setInterval(replayTick, 30)
    return () => clearInterval(timer)
  }, [replayTick])

  useEffect(() => {
    if (cap > 0 && revealed >= cap) replayDone()
  }, [revealed, cap, replayDone])

  return (
    <div className="center-box">
      <h2>재생 중…</h2>
      <p data-replay-progress>{revealed} / {cap} 봉</p>
      <progress value={revealed} max={cap} />
      <button onClick={replayDone}>건너뛰기</button>
    </div>
  )
}

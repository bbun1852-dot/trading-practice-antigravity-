import { useQuizStore } from '../store'

export function StartScreen() {
  const start = useQuizStore((s) => s.start)
  return (
    <div className="center-box">
      <h1>chart-drill</h1>
      <p>차트를 보고 판단하고, 근거까지 채점받는다.</p>
      <button className="primary" onClick={start}>문제 시작</button>
    </div>
  )
}

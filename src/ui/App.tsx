/**
 * 화면 라우팅 — 라우터 없이 phase 하나로 가른다 (스펙 §2).
 * 오답노트는 phase 와 독립된 오버레이 축이다.
 */
import { useEffect } from 'react'
import { useQuizStore } from './store'
import { stubQuestion } from './dev/stubQuestion'
import { StartScreen } from './screens/StartScreen'
import { AnsweringScreen } from './screens/AnsweringScreen'
import { ReplayScreen } from './screens/ReplayScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { NotebookScreen } from './screens/NotebookScreen'

export function App() {
  const phase = useQuizStore((s) => s.phase)
  const notebookOpen = useQuizStore((s) => s.notebookOpen)
  const questionReady = useQuizStore((s) => s.questionReady)
  const openNotebook = useQuizStore((s) => s.openNotebook)

  // 문제 공급 — 지금은 스텁, Task 4 가 실제 파이프라인으로 대체한다.
  // questionReady 는 loading 단계가 아니면 무시하므로(store 규약) 늦게 도착해도 안전하다.
  useEffect(() => {
    if (phase !== 'loading') return
    const t = setTimeout(() => questionReady(stubQuestion()), 300)
    return () => clearTimeout(t)
  }, [phase, questionReady])

  return (
    <div className="app">
      <header className="topbar">
        <strong>chart-drill</strong>
        <span className="phase-indicator" data-phase={phase}>{phaseLabel(phase)}</span>
        <span className="spacer" />
        <button onClick={openNotebook}>오답노트</button>
      </header>
      <main className="screen">
        {phase === 'idle' && <StartScreen />}
        {phase === 'loading' && <p className="loading">문제 만드는 중…</p>}
        {phase === 'answering' && <AnsweringScreen />}
        {phase === 'replaying' && <ReplayScreen />}
        {phase === 'review' && <ReviewScreen />}
      </main>
      {notebookOpen && <NotebookScreen />}
    </div>
  )
}

function phaseLabel(p: string): string {
  switch (p) {
    case 'idle': return '대기'
    case 'loading': return '출제 중'
    case 'answering': return '풀이'
    case 'replaying': return '재생'
    case 'review': return '복기'
    default: return p
  }
}

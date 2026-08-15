/**
 * 오답노트 오버레이 껍데기 — 목록·상세·통계는 Task 8 이 채운다.
 */
import { useQuizStore } from '../store'

export function NotebookScreen() {
  const closeNotebook = useQuizStore((s) => s.closeNotebook)
  return (
    <div className="notebook-overlay">
      <div className="notebook-panel">
        <header>
          <h2>오답노트 (Task 8)</h2>
          <button onClick={closeNotebook}>닫기</button>
        </header>
        <p>저장된 문제 목록·자주 놓친 근거 통계가 여기 온다.</p>
      </div>
    </div>
  )
}

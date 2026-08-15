/**
 * 복기 화면 껍데기 — 채점·리포트·오버레이·34점 패널은 Task 7 이 채운다.
 * 렌더링 계약 R1~R3(스펙 §5.3)도 그때 테스트와 함께 들어온다.
 */
import { useQuizStore } from '../store'

export function ReviewScreen() {
  const draft = useQuizStore((s) => s.draft)
  const next = useQuizStore((s) => s.next)

  return (
    <div className="center-box">
      <h2>복기 (Task 7)</h2>
      <p>제출한 방향: {draft.direction === 'long' ? '롱' : draft.direction === 'short' ? '숏' : '관망'}</p>
      <p>체크한 태그: {draft.tags.size}개</p>
      <button className="primary" onClick={next}>다음 문제</button>
    </div>
  )
}

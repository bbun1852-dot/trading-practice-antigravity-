/**
 * 오답노트 오버레이 껍데기 — 목록·상세·통계는 Task 8 이 채운다.
 */
import { useEffect, useState } from 'react'
import { useQuizStore } from '../store'
import { IndexedDBNotebook, type ReviewEntry } from '../../data/notebook'

export function NotebookScreen() {
  const closeNotebook = useQuizStore((s) => s.closeNotebook)
  const loadReview = useQuizStore((s) => s.loadReview)
  const [entries, setEntries] = useState<ReviewEntry[]>([])

  useEffect(() => {
    if (typeof indexedDB === 'undefined') return
    const db = new IndexedDBNotebook()
    db.listAll().then(setEntries).catch(console.error)
  }, [])

  return (
    <div className="notebook-overlay">
      <div className="notebook-panel">
        <header>
          <h2>오답노트</h2>
          <button onClick={closeNotebook}>닫기</button>
        </header>
        <div className="notebook-content" style={{ overflowY: 'auto', maxHeight: '70vh' }}>
          {entries.length === 0 ? (
            <p>저장된 풀이 기록이 없습니다.</p>
          ) : (
            <>
              <div style={{ marginBottom: '16px', padding: '12px', background: '#2a2a2a', borderRadius: '4px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>통계 요약</h3>
                <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                  <span>총 풀이 수: <strong>{entries.length}</strong>건</span>
                  <span>평균 점수: <strong>{(entries.reduce((sum, e) => sum + e.score, 0) / entries.length).toFixed(1)}</strong>점</span>
                </div>
              </div>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ padding: '8px' }}>일시</th>
                  <th style={{ padding: '8px' }}>종목</th>
                  <th style={{ padding: '8px' }}>포지션</th>
                  <th style={{ padding: '8px' }}>점수</th>
                  <th style={{ padding: '8px' }}>복기</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const date = new Date(entry.timestamp).toLocaleString()
                  return (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #222' }}>
                      <td style={{ padding: '8px' }}>{date}</td>
                      <td style={{ padding: '8px' }}>{entry.symbol}</td>
                      <td style={{ padding: '8px' }}>{entry.answer.direction === 1 ? 'LONG' : entry.answer.direction === -1 ? 'SHORT' : 'NEUTRAL'}</td>
                      <td style={{ padding: '8px' }}>{entry.score}점</td>
                      <td style={{ padding: '8px' }}>
                        <button onClick={() => loadReview(entry)} style={{ padding: '4px 8px', cursor: 'pointer' }}>
                          복기하기
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
          )}
        </div>
      </div>
    </div>
  )
}

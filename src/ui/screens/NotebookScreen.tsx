/**
 * 오답노트 오버레이 껍데기 — 목록·상세·통계는 Task 8 이 채운다.
 */
import { useEffect, useState } from 'react'
import { useQuizStore } from '../store'
import { IndexedDBNotebook, type ReviewEntry } from '../../data/notebook'

import { computeReviewStats } from '../../quiz/reviewStats'
import { TAG_BY_ID } from '../../quiz/taxonomy'

export function NotebookScreen() {
  const closeNotebook = useQuizStore((s) => s.closeNotebook)
  const loadReview = useQuizStore((s) => s.loadReview)
  const [entries, setEntries] = useState<ReviewEntry[]>([])

  useEffect(() => {
    if (typeof indexedDB === 'undefined') return
    const db = new IndexedDBNotebook()
    db.listAll().then(setEntries).catch(console.error)
  }, [])

  const stats = computeReviewStats(entries)

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
              <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '15px' }}>통계 요약</h3>
                <div style={{ display: 'flex', gap: '24px', fontSize: '13px', marginBottom: '12px' }}>
                  <span>총 풀이 수: <strong>{stats.totalCount}</strong>건</span>
                  <span>평균 점수: <strong>{stats.averageScore.toFixed(1)}</strong>점</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 4px 0', color: '#ff9800' }}>⚠️ 가장 많이 놓친 근거</h4>
                    {stats.topCoreMisses.length === 0 ? <span style={{ color: 'var(--text-dim)' }}>없음</span> : 
                      <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-dim)' }}>
                        {stats.topCoreMisses.map(s => <li key={s.tagId}>{TAG_BY_ID.get(s.tagId)?.label ?? s.tagId} ({s.count}회)</li>)}
                      </ul>
                    }
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 4px 0', color: '#f44336' }}>❌ 가장 많이 착각한 근거</h4>
                    {stats.topFalseClaims.length === 0 ? <span style={{ color: 'var(--text-dim)' }}>없음</span> : 
                      <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-dim)' }}>
                        {stats.topFalseClaims.map(s => <li key={s.tagId}>{TAG_BY_ID.get(s.tagId)?.label ?? s.tagId} ({s.count}회)</li>)}
                      </ul>
                    }
                  </div>
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
                      <td style={{ padding: '8px' }}>{entry.answer.direction === 'long' ? 'LONG' : entry.answer.direction === 'short' ? 'SHORT' : 'NEUTRAL'}</td>
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

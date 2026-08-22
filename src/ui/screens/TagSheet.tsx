import { useMemo, useState } from 'react'
import { useQuizStore } from '../store'
import { TAGS, TAG_BY_ID } from '../../quiz/taxonomy'
import { PROFILE_OF, PROFILES } from '../../quiz/ruleCheck'
import { falseClaimPenalty } from '../../quiz/grader'
import type { Timeframe } from '../../data/types'
import type { SignalKind } from '../../analysis/signalTypes'

const KIND_LABEL: Record<SignalKind, string> = {
  structure: '시장 구조 (Structure)',
  smc: '스마트머니 (SMC)',
  volume: '거래량 (Volume)',
  pattern: '차트 패턴 (Pattern)',
  candle: '캔들 패턴 (Candle)',
  momentum: '모멘텀 (Momentum)',
  ma: '이동평균 (MA)',
  fib: '피보나치 (Fibonacci)',
  volatility: '변동성 (Volatility)',
}

export function TagSheet({ timeframe }: { timeframe: Timeframe }) {
  const draft = useQuizStore((s) => s.draft)
  const toggleTag = useQuizStore((s) => s.toggleTag)

  const [mode, setMode] = useState<'simple' | '34rule'>('simple')

  const profile = PROFILES[PROFILE_OF[timeframe]]

  const maxPenalty = useMemo(() => {
    let sum = 0
    draft.tags.forEach((tagId) => {
      sum += falseClaimPenalty(tagId)
    })
    return sum
  }, [draft.tags])

  // Group generic tags (Tier 1 & 2) by kind for Simple Mode
  const genericTagsByKind = useMemo(() => {
    const groups: Partial<Record<SignalKind, string[]>> = {}
    TAGS.filter(t => t.tier <= 2).forEach((tag) => {
      if (!groups[tag.kind]) groups[tag.kind] = []
      groups[tag.kind]!.push(tag.id)
    })
    return groups
  }, [])

  return (
    <div className="tag-sheet">
      <div className="sheet-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>근거 태그 (선택)</strong>
            <button className="secondary" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => setMode(mode === 'simple' ? '34rule' : 'simple')}>
              {mode === 'simple' ? '34점 룰 패널 열기' : '일반 모드로 돌아가기'}
            </button>
          </div>
          <span className="penalty-info">
            선택 {draft.tags.size}개
            {draft.tags.size > 0 && <span> · 오답시 최대 -{maxPenalty}점</span>}
          </span>
        </div>
      </div>

      <div className="sheet-body">
        {mode === 'simple' && (
          <>
            {Object.entries(genericTagsByKind).map(([kind, tagIds]) => (
              <details key={kind} className="sheet-row" open>
                <summary>{KIND_LABEL[kind as SignalKind]}</summary>
                <div className="tag-list">
                  {tagIds.map((tagId) => {
                    const tag = TAG_BY_ID.get(tagId)
                    if (!tag) return null
                    return (
                      <label key={tagId} className="tag-item">
                        <input
                          type="checkbox"
                          checked={draft.tags.has(tagId)}
                          onChange={() => toggleTag(tagId)}
                        />
                        {tag.label}
                      </label>
                    )
                  })}
                </div>
              </details>
            ))}
          </>
        )}

        {mode === '34rule' && (
          <>
            <div style={{ padding: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', marginBottom: '8px', fontSize: '13px' }}>
              <strong>나만의 매매 진입 조건 (34점 룰)</strong><br/>
              이 패널은 상세 진입 기준을 점검하기 위해 설계되었습니다.
            </div>
            {profile.rows.map((row) => (
              <details key={row.key} className="sheet-row" open>
                <summary>
                  {row.core && <span className="core-badge">[핵심]</span>} {row.label}
                </summary>
                <div className="tag-list">
                  {row.tags.map((tagId) => {
                    const tag = TAG_BY_ID.get(tagId)
                    if (!tag) return null
                    return (
                      <label key={tagId} className="tag-item">
                        <input
                          type="checkbox"
                          checked={draft.tags.has(tagId)}
                          onChange={() => toggleTag(tagId)}
                        />
                        {tag.label}
                      </label>
                    )
                  })}
                </div>
              </details>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { useQuizStore } from '../store'
import { PROFILE_OF, PROFILES } from '../../quiz/ruleCheck'
import { TAG_BY_ID } from '../../quiz/taxonomy'
import { falseClaimPenalty } from '../../quiz/grader'
import type { Timeframe } from '../../data/types'

export function TagSheet({ timeframe }: { timeframe: Timeframe }) {
  const draft = useQuizStore((s) => s.draft)
  const toggleTag = useQuizStore((s) => s.toggleTag)

  const profile = PROFILES[PROFILE_OF[timeframe]]

  const maxPenalty = useMemo(() => {
    let sum = 0
    draft.tags.forEach((tagId) => {
      sum += falseClaimPenalty(tagId)
    })
    return sum
  }, [draft.tags])

  // Group unscored tags by kind
  const unscoredByKind = useMemo(() => {
    const groups: Record<string, string[]> = {}
    profile.unscored.forEach((tagId) => {
      const tag = TAG_BY_ID.get(tagId)
      if (!tag) return
      if (!groups[tag.kind]) groups[tag.kind] = []
      groups[tag.kind].push(tagId)
    })
    return groups
  }, [profile.unscored])

  return (
    <div className="tag-sheet">
      <div className="sheet-header">
        <strong>{profile.label}</strong>
        <span className="penalty-info">
          선택 {draft.tags.size}개
          {draft.tags.size > 0 && <span> · 전부 헛다리면 -{maxPenalty}점</span>}
        </span>
      </div>

      <div className="sheet-body">
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

        {profile.unscored.length > 0 && (
          <details className="sheet-row unscored">
            <summary>시트에 없는 근거 (보조 입력)</summary>
            <div className="unscored-groups">
              {Object.entries(unscoredByKind).map(([kind, tags]) => (
                <div key={kind} className="tag-group">
                  <div className="group-label">{kind}</div>
                  <div className="tag-list">
                    {tags.map((tagId) => {
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
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

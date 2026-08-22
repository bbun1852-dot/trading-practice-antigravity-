import { useMemo } from 'react'
import { useQuizStore } from '../store'
import { TAGS, TAG_BY_ID } from '../../quiz/taxonomy'
import { falseClaimPenalty } from '../../quiz/grader'
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

export function TagSheet() {
  const draft = useQuizStore((s) => s.draft)
  const toggleTag = useQuizStore((s) => s.toggleTag)

  const maxPenalty = useMemo(() => {
    let sum = 0
    draft.tags.forEach((tagId) => {
      sum += falseClaimPenalty(tagId)
    })
    return sum
  }, [draft.tags])

  // Group all tags by kind
  const tagsByKind = useMemo(() => {
    const groups: Partial<Record<SignalKind, string[]>> = {}
    TAGS.forEach((tag) => {
      if (!groups[tag.kind]) groups[tag.kind] = []
      groups[tag.kind]!.push(tag.id)
    })
    return groups
  }, [])

  return (
    <div className="tag-sheet">
      <div className="sheet-header">
        <strong>근거 태그 (종합)</strong>
        <span className="penalty-info">
          선택 {draft.tags.size}개
          {draft.tags.size > 0 && <span> · 오답시 최대 -{maxPenalty}점</span>}
        </span>
      </div>

      <div className="sheet-body">
        {Object.entries(tagsByKind).map(([kind, tagIds]) => (
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
      </div>
    </div>
  )
}

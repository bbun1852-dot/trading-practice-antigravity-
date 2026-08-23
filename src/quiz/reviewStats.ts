import type { ReviewEntry } from '../data/notebook'

export type StatResult = {
  totalCount: number
  averageScore: number
  topCoreMisses: Array<{ tagId: string; count: number }>
  topFalseClaims: Array<{ tagId: string; count: number }>
}

export function computeReviewStats(entries: ReviewEntry[]): StatResult {
  let totalScore = 0
  const coreFreq: Record<string, number> = {}
  const falseFreq: Record<string, number> = {}

  for (const e of entries) {
    totalScore += e.score
    for (const tag of e.coreMisses ?? []) {
      coreFreq[tag] = (coreFreq[tag] ?? 0) + 1
    }
    for (const tag of e.falseClaims ?? []) {
      falseFreq[tag] = (falseFreq[tag] ?? 0) + 1
    }
  }

  const sortFreq = (freq: Record<string, number>) => {
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([tagId, count]) => ({ tagId, count }))
  }

  return {
    totalCount: entries.length,
    averageScore: entries.length > 0 ? totalScore / entries.length : 0,
    topCoreMisses: sortFreq(coreFreq),
    topFalseClaims: sortFreq(falseFreq),
  }
}


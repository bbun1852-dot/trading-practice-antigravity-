import type { Candle, Timeframe } from '../data/types'

export type Direction = 'long' | 'short' | 'flat'
export type QuestionType = 'normal' | 'trap' | 'no_setup'
export type Difficulty = 'easy' | 'medium' | 'hard'

export type SetupCandidate = {
  barIndex: number
  setupScore: number
  difficulty: Difficulty
  /** 유효 근거의 가중 합이 큰 쪽 */
  dominantSide: 'bullish' | 'bearish' | 'neutral'
  activeCount: number
}

export type Question = {
  symbol: string
  timeframe: Timeframe
  /** 창 첫 봉의 time (초). {symbol, timeframe, startTime, decisionIndex} 가 재현 키다 */
  startTime: number
  /** 창 내 인덱스. 이 봉까지가 사용자에게 보인다 */
  decisionIndex: number
  type: QuestionType
  difficulty: Difficulty
  /** 은닉 구간을 포함한 창 전체 */
  candles: Candle[]
}

export type Answer = {
  direction: Direction
  entry?: number
  stopLoss?: number
  takeProfit?: number
  /** 체크한 태그 id. 최대 15개 */
  tags: string[]
  memo?: string
}

export type ReplayResult = {
  filled: boolean
  exit: 'tp' | 'sl' | 'forced' | 'none'
  exitBarIndex: number | null
  pnlPct: number
  /** 손실 1R 기준 배수. 손절폭이 0이면 0 */
  r: number
}

export type EvidenceVerdict = {
  /** 체크했고 유효한 근거 */
  hits: string[]
  /** 핵심 근거인데 체크하지 않음 — 감점 대상 */
  coreMisses: string[]
  /** 유효하지만 핵심이 아닌 미체크 근거 — 감점 없음 */
  reference: string[]
  /** 체크했으나 그 시점에 존재하지 않은 근거 */
  falseClaims: string[]
}

export type GradeReport = {
  direction: { correct: Direction; answered: Direction; score: number }
  execution: { score: number; notes: string[] }
  evidence: { score: number; verdict: EvidenceVerdict }
  /** 근거 + 실행 */
  processScore: number
  /** 방향 + 재생 결과 */
  outcomeScore: number
  totalScore: number
  judgement: string
  replay: ReplayResult
}

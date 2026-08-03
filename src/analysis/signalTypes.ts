import type { Candle } from '../data/types'

export type Tier = 1 | 2 | 3 | 4
export type Confidence = 'A' | 'B' | 'C'
export type SignalSide = 'bullish' | 'bearish' | 'neutral'
export type SignalKind =
  | 'structure' | 'smc' | 'volume' | 'pattern' | 'candle'
  | 'momentum' | 'ma' | 'fib' | 'volatility'

export const TIER_WEIGHT: Record<Tier, number> = { 1: 5, 2: 4, 3: 3, 4: 2 }

export type Signal = {
  id: string
  tier: Tier
  kind: SignalKind
  side: SignalSide
  /** 신호가 '확정'된 봉의 인덱스. 절대 미래 봉을 가리키지 않는다. */
  barIndex: number
  confidence: Confidence
  strength: 1 | 2 | 3
  evidence: string
  refs?: {
    price?: number
    priceHigh?: number
    priceLow?: number
    fromBar?: number
    toBar?: number
    /** 확정에 이후 봉이 필요한 신호의 실제 피벗 위치 */
    pivotBar?: number
  }
}

export type Detector = (candles: Candle[]) => Signal[]
